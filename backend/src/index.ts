import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Prisma, PrismaClient, EmailStatus } from "@prisma/client";
import { Client } from "@elastic/elasticsearch";
import Redis from "ioredis";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { env } from "./config";
import { connection, emailQueue } from "./queue";
import { campaignEmailIdempotencyKey, campaignIdempotencyKey, idempotencyKey, normalizeRecipients } from "./recipients";

const prisma = new PrismaClient();
const elastic = new Client({
  node: env.ELASTICSEARCH_URL,
  auth: {
    username: env.ELASTICSEARCH_USERNAME,
    password: env.ELASTICSEARCH_PASSWORD,
  },
});
const bullAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: bullAdapter,
});
const app = express();
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 86_400_000,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user as Express.User));
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (_access, _refresh, profile, done) => {
        const user = await prisma.user.upsert({
          where: { googleId: profile.id },
          update: {
            name: profile.displayName,
            avatarUrl: profile.photos?.[0]?.value,
          },
          create: {
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value ?? `${profile.id}@google.invalid`,
            avatarUrl: profile.photos?.[0]?.value,
          },
        });
        done(null, user);
      },
    ),
  );

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
    }
  }
}
declare module "express-session" {
  interface SessionData {
    slackState?: string;
  }
}
const auth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user)
    return res.status(401).json({ error: "Authentication required" });
  next();
};
const scheduleSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(100_000),
  senderId: z.string().min(1),
  startTime: z.coerce.date(),
  delayBetweenEmails: z.number().int().min(2000).max(86_400_000),
  hourlyLimit: z.number().int().min(1).max(2000),
  recipients: z.array(z.string().email()).min(1).max(10_000),
});
const page = (req: Request) => ({
  page: Math.max(1, Number(req.query.page) || 1),
  limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
});

app.get("/health", async (_req, res) => {
  const services: Record<string, string> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    services.postgres = "up";
  } catch {
    services.postgres = "down";
  }
  try {
    const redis = new Redis(connection.url, { lazyConnect: true });
    await redis.connect();
    await redis.ping();
    await redis.quit();
    services.redis = "up";
  } catch {
    services.redis = "down";
  }
  try {
    await elastic.ping();
    services.elasticsearch = "up";
  } catch {
    services.elasticsearch = "down";
  }
  res
    .status(Object.values(services).every((v) => v === "up") ? 200 : 503)
    .json({
      status: Object.values(services).every((v) => v === "up")
        ? "ok"
        : "degraded",
      services,
    });
});
app.get(
  "/api/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);
app.get(
  "/api/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${env.FRONTEND_URL}/login`,
  }),
  (_req, res) => res.redirect(`${env.FRONTEND_URL}/dashboard`),
);
app.get("/api/auth/me", (req, res) => res.json({ user: req.user ?? null }));
app.post("/api/auth/logout", (req, res, next) =>
  req.logout((err) => (err ? next(err) : res.status(204).end())),
);
app.get("/api/senders", auth, async (req, res) =>
  res.json(
    await prisma.sender.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        smtpHost: true,
        smtpPort: true,
      },
    }),
  ),
);
app.post("/api/senders", auth, async (req, res) => {
  const data = z
    .object({
      email: z.string().email(),
      displayName: z.string().optional(),
      smtpHost: z.string(),
      smtpPort: z.number().int(),
      smtpUser: z.string(),
      smtpPassword: z.string(),
    })
    .parse(req.body);
  const sender = await prisma.sender.create({
    data: { ...data, userId: req.user!.id },
  });
  res.status(201).json({ ...sender, smtpPassword: undefined });
});
app.post("/api/emails/schedule", auth, async (req, res) => {
  const data = scheduleSchema.parse(req.body);
  if (data.startTime.getTime() < Date.now())
    return res.status(400).json({ error: "startTime must be in the future" });
  const sender = await prisma.sender.findFirst({
    where: { id: data.senderId, userId: req.user!.id },
  });
  if (!sender) return res.status(404).json({ error: "Sender not found" });
  const recipients = normalizeRecipients(data.recipients);
  const campaignKey = campaignIdempotencyKey(req.user!.id, sender.id, data.subject, data.body, data.startTime, data.delayBetweenEmails, data.hourlyLimit, recipients);
  const emailKeys = recipients.map((recipient, index) => campaignEmailIdempotencyKey(campaignKey, recipient, index));
  const legacyEmailKeys = recipients.map(recipient => idempotencyKey(req.user!.id, sender.id, recipient, data.startTime));
  const findExistingCampaign = async (keys: string[]) => {
    const existingEmails = await prisma.email.findMany({
      where: { idempotencyKey: { in: keys }, campaign: { userId: req.user!.id } },
      select: { campaignId: true, campaign: { select: { id: true, totalEmails: true } } },
    });
    if (existingEmails.length !== keys.length) return null;
    const campaignIds = new Set(existingEmails.map(email => email.campaignId));
    return campaignIds.size === 1 ? existingEmails[0].campaign : null;
  };
  const existingCampaign = await findExistingCampaign(emailKeys) ?? await findExistingCampaign(legacyEmailKeys);
  if (existingCampaign) return res.json({ campaignId: existingCampaign.id, totalEmails: existingCampaign.totalEmails, alreadyExists: true });

  let campaign;
  try {
    campaign = await prisma.campaign.create({
      data: {
        userId: req.user!.id,
        senderId: sender.id,
        subject: data.subject,
        body: data.body,
        startTime: data.startTime,
        delayBetweenEmails: data.delayBetweenEmails,
        hourlyLimit: data.hourlyLimit,
        totalEmails: recipients.length,
        emails: {
          create: recipients.map((recipient, index) => ({
            recipient,
            subject: data.subject,
            body: data.body,
            senderId: sender.id,
            scheduledAt: new Date(data.startTime.getTime() + index * data.delayBetweenEmails),
            idempotencyKey: emailKeys[index],
          })),
        },
      },
      include: { emails: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrentCampaign = await findExistingCampaign(emailKeys) ?? await findExistingCampaign(legacyEmailKeys);
      if (concurrentCampaign) return res.json({ campaignId: concurrentCampaign.id, totalEmails: concurrentCampaign.totalEmails, alreadyExists: true });
    }
    throw error;
  }
  await Promise.all(
    campaign.emails.map(async (email) => {
      const job = await emailQueue.add(
        `email:${email.id}`,
        { emailId: email.id },
        {
          jobId: `email:${email.id}`,
          delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
      await prisma.email.update({
        where: { id: email.id },
        data: { bullJobId: job.id },
      });
    }),
  );
  res
    .status(201)
    .json({ campaignId: campaign.id, totalEmails: recipients.length });
});
const listEmails =
  (status?: EmailStatus) => async (req: Request, res: Response) => {
    const { page: current, limit } = page(req);
    const where = {
      campaign: { userId: req.user!.id },
      ...(status ? { status } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.email.findMany({
        where,
        orderBy: { scheduledAt: "desc" },
        skip: (current - 1) * limit,
        take: limit,
        select: {
          id: true,
          recipient: true,
          subject: true,
          scheduledAt: true,
          sentAt: true,
          status: true,
          errorMessage: true,
        },
      }),
      prisma.email.count({ where }),
    ]);
    res.json({
      items,
      page: current,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  };
app.get("/api/emails/scheduled", auth, listEmails(EmailStatus.scheduled));
app.get("/api/emails/sent", auth, listEmails(EmailStatus.sent));
app.get("/api/emails/failed", auth, listEmails(EmailStatus.failed));
app.get("/api/emails/search", auth, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ items: [] });
  try {
    const result = await elastic.search({
      index: "emails",
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: q,
                fields: ["recipient", "subject", "body", "status"],
              },
            },
          ],
          filter: [{ term: { userId: req.user!.id } }],
        },
      },
    });
    res.json({ items: result.hits.hits.map((hit) => hit._source) });
  } catch {
    res.status(503).json({ error: "Search is temporarily unavailable" });
  }
});
app.get("/api/campaigns", auth, async (req, res) => {
  const { page: current, limit } = page(req);
  const where = { userId: req.user!.id };
  const [items, total] = await prisma.$transaction([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (current - 1) * limit,
      take: limit,
    }),
    prisma.campaign.count({ where }),
  ]);
  res.json({
    items,
    page: current,
    limit,
    total,
    pages: Math.ceil(total / limit),
  });
});
app.get("/api/slack/connect", auth, (req, res) => {
  if (!env.SLACK_CLIENT_ID)
    return res.status(503).json({ error: "Slack OAuth is not configured" });
  const state = randomUUID();
  req.session.slackState = state;
  res.redirect(
    `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(env.SLACK_CLIENT_ID)}&scope=chat:write,channels:read&redirect_uri=${encodeURIComponent(env.SLACK_REDIRECT_URI)}&state=${state}`,
  );
});
app.get("/api/slack/callback", async (req, res, next) => {
  try {
    if (
      !req.user ||
      !env.SLACK_CLIENT_ID ||
      !env.SLACK_CLIENT_SECRET ||
      req.query.state !== req.session.slackState
    )
      return res.status(400).send("Invalid Slack OAuth state");
    const params = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code: String(req.query.code ?? ""),
      redirect_uri: env.SLACK_REDIRECT_URI,
    });
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const payload = (await response.json()) as {
      ok: boolean;
      access_token?: string;
      team?: { id?: string; name?: string };
    };
    if (!payload.ok || !payload.access_token || !payload.team?.id)
      return res.status(502).send("Slack connection failed");
    const channelsResponse = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel&limit=1",
      { headers: { authorization: `Bearer ${payload.access_token}` } },
    );
    const channels = (await channelsResponse.json()) as {
      channels?: Array<{ id?: string }>;
    };
    const channelId = channels.channels?.[0]?.id;
    await prisma.slackConnection.upsert({
      where: { userId: req.user.id },
      update: {
        teamId: payload.team.id,
        teamName: payload.team.name ?? "Slack workspace",
        channelId,
        accessToken: payload.access_token,
      },
      create: {
        userId: req.user.id,
        teamId: payload.team.id,
        teamName: payload.team.name ?? "Slack workspace",
        channelId,
        accessToken: payload.access_token,
      },
    });
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (error) {
    next(error);
  }
});
app.get("/api/slack/status", auth, async (req, res) =>
  res.json({
    connected: Boolean(
      await prisma.slackConnection.findUnique({
        where: { userId: req.user!.id },
        select: { id: true, teamId: true, teamName: true },
      }),
    ),
  }),
);
app.post("/api/slack/disconnect", auth, async (req, res) => {
  await prisma.slackConnection.deleteMany({ where: { userId: req.user!.id } });
  res.status(204).end();
});
app.get("/api-docs", (_req, res) =>
  res.json({
    openapi: "3.0.0",
    info: { title: "ReachInbox Scheduler API", version: "1.0.0" },
    servers: [{ url: `http://localhost:${env.PORT}` }],
    paths: {
      "/health": { get: { summary: "Service health" } },
      "/api/auth/google": { get: { summary: "Start Google OAuth" } },
      "/api/emails/schedule": {
        post: { summary: "Create campaign and delayed email jobs" },
      },
      "/api/emails/search": {
        get: { summary: "Search indexed email records" },
      },
    },
  }),
);
const bullUser = process.env.BULL_BOARD_USERNAME ?? "admin";
const bullPassword = process.env.BULL_BOARD_PASSWORD ?? "change-me";
app.use(
  "/admin/queues",
  (req, res, next) => {
    const encoded = req.headers.authorization?.split(" ")[1] ?? "";
    const decoded = Buffer.from(encoded, "base64").toString();
    if (decoded !== `${bullUser}:${bullPassword}`) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Bull Board"');
      return res.status(401).end();
    }
    next();
  },
  bullAdapter.getRouter(),
);
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: "Invalid request", details: error.issues });
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});
app.listen(env.PORT, () =>
  console.log(`API listening on http://localhost:${env.PORT}`),
);
export { app, prisma };
