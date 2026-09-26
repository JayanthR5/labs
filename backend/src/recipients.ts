import { createHash } from "node:crypto";

export const normalizeRecipients = (recipients: string[]) => [...new Set(recipients.map(email => email.trim().toLowerCase()).filter(Boolean))];
export const idempotencyKey = (userId: string, senderId: string, recipient: string, startTime: Date) => `${userId}:${senderId}:${recipient}:${startTime.toISOString()}`;
export const campaignIdempotencyKey = (userId: string, senderId: string, subject: string, body: string, startTime: Date, delayBetweenEmails: number, hourlyLimit: number, recipients: string[]) => createHash("sha256").update(JSON.stringify({ userId, senderId, subject, body, startTime: startTime.toISOString(), delayBetweenEmails, hourlyLimit, recipients })).digest("hex");
export const campaignEmailIdempotencyKey = (campaignKey: string, recipient: string, index: number) => `${campaignKey}:${index}:${recipient}`;
