import { randomUUID } from 'node:crypto';
const recipients = Array.from({ length: 1000 }, (_, index) => `load-${index}-${randomUUID()}@example.test`);
console.log(JSON.stringify({ subject: 'Load test', recipients, delayBetweenEmails: 2000, hourlyLimit: 200 }, null, 2));
