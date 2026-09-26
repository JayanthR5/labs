import { Queue, Worker } from "bullmq";

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const queueName = `reachinbox-smoke-${Date.now()}`;
const queue = new Queue(queueName, { connection });
const worker = new Worker(queueName, async (job) => ({ jobId: job.id, ok: true }), { connection });

try {
  const job = await queue.add("delayed-check", { kind: "smoke" }, { delay: 250, removeOnComplete: true });
  const result = await new Promise((resolve, reject) => {
    worker.on("completed", (completedJob, value) => completedJob.id === job.id ? resolve(value) : undefined);
    worker.on("failed", reject);
  });
  console.log(JSON.stringify({ redis: connection.url, queue: queueName, jobId: job.id, result }));
} finally {
  await worker.close();
  await queue.close();
}
