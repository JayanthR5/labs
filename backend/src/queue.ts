import { Queue } from 'bullmq';
import { env } from './config';
export const connection = { url: env.REDIS_URL };
export const emailQueue = new Queue('emailQueue', { connection });
export const indexingQueue = new Queue('indexingQueue', { connection });
