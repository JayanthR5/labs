type ScheduledEmail = {
  id: string;
  scheduledAt: Date;
  bullJobId: string | null;
  status: string;
};

type RecoveredJob = { id?: string };
type QueueLike = {
  getJob: (jobId: string) => Promise<RecoveredJob | undefined>;
  add: (name: string, data: { emailId: string }, options: {
    jobId: string;
    delay: number;
    attempts: number;
    backoff: { type: "exponential"; delay: number };
    removeOnComplete: number;
    removeOnFail: number;
  }) => Promise<RecoveredJob>;
};
type EmailStore = {
  findMany: (args: any) => Promise<ScheduledEmail[]>;
  update: (args: any) => Promise<unknown>;
};
type RecoveryLogger = {
  info: (data: object, message: string) => void;
};

const jobOptions = (email: ScheduledEmail, now: number) => ({
  jobId: `email:${email.id}`,
  delay: Math.max(0, email.scheduledAt.getTime() - now),
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
});

export const ensureScheduledEmailJob = async ({
  email,
  queue,
  emailStore,
  now,
  allowPastDue = false,
}: {
  email: ScheduledEmail;
  queue: QueueLike;
  emailStore: EmailStore;
  now: number;
  allowPastDue?: boolean;
}) => {
  if (email.status !== "scheduled" || email.bullJobId || (!allowPastDue && email.scheduledAt.getTime() < now)) return "skipped" as const;

  const jobId = `email:${email.id}`;
  const existingJob = await queue.getJob(jobId);
  const job = existingJob ?? await queue.add(`email:${email.id}`, { emailId: email.id }, jobOptions(email, now));
  const persistedJobId = job.id ?? jobId;
  if (email.bullJobId !== persistedJobId) {
    await emailStore.update({ where: { id: email.id }, data: { bullJobId: persistedJobId } });
  }
  return existingJob ? "reused" as const : "created" as const;
};

export const recoverMissingScheduledJobs = async ({
  queue,
  emailStore,
  logger,
  now = Date.now(),
}: {
  queue: QueueLike;
  emailStore: EmailStore;
  logger: RecoveryLogger;
  now?: number;
}) => {
  const emails = await emailStore.findMany({
    where: {
      status: "scheduled",
      bullJobId: null,
      scheduledAt: { gte: new Date(now) },
    },
    select: { id: true, scheduledAt: true, bullJobId: true, status: true },
  });
  for (const email of emails) {
    const result = await ensureScheduledEmailJob({ email, queue, emailStore, now });
    logger.info({ emailId: email.id, result }, "Scheduled email job recovery checked");
  }
  return emails.length;
};
