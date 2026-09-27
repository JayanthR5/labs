export type ScheduledEmail = {
  id: string;
  scheduledAt: Date;
  bullJobId: string | null;
};

export type ScheduledJob = {
  id?: string;
  remove?: () => Promise<unknown>;
};

export type SchedulingQueue = {
  getJob: (jobId: string) => Promise<ScheduledJob | undefined>;
  add: (name: string, data: { emailId: string }, options: {
    jobId: string;
    delay: number;
    attempts: number;
    backoff: { type: "exponential"; delay: number };
    removeOnComplete: number;
    removeOnFail: number;
  }) => Promise<ScheduledJob>;
};

const jobOptions = (email: ScheduledEmail, jobId: string, now: number) => ({
  jobId,
  delay: Math.max(0, email.scheduledAt.getTime() - now),
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
});

export const ensureScheduledEmailJob = async ({
  email,
  queue,
  now = Date.now(),
}: {
  email: ScheduledEmail;
  queue: SchedulingQueue;
  now?: number;
}) => {
  const jobId = `email-${email.id}`;
  const existingJob = await queue.getJob(jobId);
  const job = existingJob ?? await queue.add(`email-${email.id}`, { emailId: email.id }, jobOptions(email, jobId, now));
  return { job, jobId: job.id ?? jobId, created: !existingJob };
};