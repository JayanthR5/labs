import { Queue, Worker, Job } from "bullmq";
import { PrismaClient, EmailStatus } from "@prisma/client";
import nodemailer from "nodemailer";
import { Client } from "@elastic/elasticsearch";
import Redis from "ioredis";
import pino from "pino";
import { shouldRetry } from "./retry";
import { workerConfig } from "./config";
import { recoverMissingScheduledJobs } from "./recovery";

const logger = pino();
const prisma = new PrismaClient();
const connection = { url: workerConfig.redisUrl };
const emailQueue = new Queue("emailQueue", { connection });
const redis = new Redis(workerConfig.redisUrl);
const elastic = new Client({
  node: workerConfig.elasticsearchUrl,
  auth: {
    username: workerConfig.elasticsearchUsername,
    password: workerConfig.elasticsearchPassword,
  },
});

redis.on("connect", () => logger.info("Redis connection established"));
redis.on("error", (error) => logger.error({ error: error.message }, "Redis connection error"));

const reserveSlotScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local hourlyLimit = tonumber(ARGV[2])
local minimumDelay = tonumber(ARGV[3])
if count >= hourlyLimit then
  return {0, tonumber(ARGV[4])}
end
local lastSent = tonumber(redis.call('GET', KEYS[2]) or '0')
local nextAllowed = lastSent + minimumDelay
if nextAllowed > now then
  return {0, nextAllowed}
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 7200)
redis.call('SET', KEYS[2], now, 'EX', 7200)
return {1, now}
`;

const reschedule = async (emailId: string, job: Job, timestamp: number, reason: string) => {
  await prisma.email.update({ where: { id: emailId }, data: { status: EmailStatus.scheduled } });
  await job.moveToDelayed(Math.max(Date.now() + 100, timestamp), job.token);
  logger.info({ jobId: job.id, emailId, reason }, "Email job rescheduled");
};

const worker = new Worker(
  "emailQueue",
  async (job: Job<{ emailId: string }>) => {
    logger.info({ jobId: job.id, emailId: job.data.emailId }, "Email job received");
    const email = await prisma.email.findUnique({ where: { id: job.data.emailId }, include: { sender: true, campaign: true } });
    if (!email || email.status === EmailStatus.sent || email.status === EmailStatus.cancelled) return;

    const claimed = await prisma.email.updateMany({
      where: { id: email.id, status: EmailStatus.scheduled },
      data: { status: EmailStatus.processing, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      logger.info({ jobId: job.id, emailId: email.id }, "Email job skipped after atomic claim");
      return;
    }

    const now = Date.now();
    const hour = Math.floor(now / 3_600_000);
    const hourlyLimit = Math.min(email.campaign.hourlyLimit, workerConfig.maximumEmailsPerHour);
    const minimumDelay = Math.max(email.campaign.delayBetweenEmails, workerConfig.minimumDelayMs);
    const result = (await redis.eval(
      reserveSlotScript,
      2,
      `email-rate:${email.senderId}:${hour}`,
      `email-delay:${email.senderId}`,
      now,
      hourlyLimit,
      minimumDelay,
      (hour + 1) * 3_600_000,
    )) as [number, number];
    if (result[0] !== 1) {
      const reason = result[1] >= (hour + 1) * 3_600_000 ? "hourly limit" : "minimum delay";
      if (reason === "hourly limit") {
        logger.info({ emailId: email.id, senderId: email.senderId, hourlyLimit }, "Hourly rate limit reached");
        try {
          const notified = await redis.set(`email-rate-notified:${email.senderId}:${hour}`, "1", "EX", 7200, "NX");
          if (notified) {
            const slack = await prisma.slackConnection.findUnique({ where: { userId: email.campaign.userId } });
            if (slack) {
              await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: { authorization: `Bearer ${slack.accessToken}`, "content-type": "application/json" },
                body: JSON.stringify({ channel: slack.channelId ?? slack.teamId, text: `Email Scheduler Alert\nSender: ${email.sender.email}\nHourly limit reached (${hourlyLimit} emails/hour). Remaining emails have been rescheduled.` }),
              }).catch((error) => logger.warn({ error: error instanceof Error ? error.message : "Slack error", emailId: email.id }, "Slack notification failed"));
            }
          }
        } catch (error) {
          logger.warn({ error: error instanceof Error ? error.message : "Slack notification error", emailId: email.id }, "Slack notification check failed");
        }
      }
      await reschedule(email.id, job, result[1], reason);
      return;
    }

    const transport = nodemailer.createTransport({
      host: email.sender.smtpHost,
      port: email.sender.smtpPort,
      secure: email.sender.smtpPort === 465,
      auth: { user: email.sender.smtpUser, pass: email.sender.smtpPassword },
    });
    try {
      const sent = await transport.sendMail({ from: email.sender.email, to: email.recipient, subject: email.subject, text: email.body });
      const updated = await prisma.email.update({
        where: { id: email.id },
        data: { status: EmailStatus.sent, sentAt: new Date(), messageId: sent.messageId, previewUrl: nodemailer.getTestMessageUrl(sent) || undefined },
      });
      logger.info({ jobId: job.id, emailId: email.id }, "Email sent");
      try {
        await elastic.indices.create({ index: "emails" }).catch(() => undefined);
        await elastic.index({ index: "emails", id: updated.id, document: { ...updated, userId: email.campaign.userId } });
      } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : "Elasticsearch error", emailId: email.id }, "Elasticsearch indexing failed");
      }
    } catch (error) {
      const retrying = shouldRetry(job.attemptsMade, Number(job.opts.attempts ?? 1));
      await prisma.email.update({
        where: { id: email.id },
        data: { status: retrying ? EmailStatus.scheduled : EmailStatus.failed, errorMessage: error instanceof Error ? error.message : "SMTP failure" },
      });
      throw error;
    }
  },
  { connection, concurrency: workerConfig.concurrency },
);

logger.info({ concurrency: workerConfig.concurrency, queue: "emailQueue" }, "Starting email worker");
worker.on("ready", () => {
  logger.info({ concurrency: workerConfig.concurrency }, "Email worker started");
  void recoverMissingScheduledJobs({ queue: emailQueue, emailStore: prisma.email, logger }).catch(error => logger.error({ error: error instanceof Error ? error.message : "Recovery error" }, "Scheduled email recovery failed"));
});
worker.on("completed", (job) => logger.info({ jobId: job.id }, "Email job completed"));
worker.on("failed", (job, error) => logger.error({ jobId: job?.id, error: error.message }, "Email job failed"));
worker.on("error", (error) => logger.error({ error: error.message }, "Email worker error"));
redis.on("reconnecting", () => logger.warn("Redis reconnecting"));
redis.on("close", () => logger.warn("Redis connection closed"));

const shutdown = async () => {
  await worker.close();
  await emailQueue.close();
  await redis.quit();
  await prisma.$disconnect();
};
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
