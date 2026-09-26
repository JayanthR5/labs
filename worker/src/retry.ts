export const shouldRetry = (attemptsMade: number, maxAttempts: number) => attemptsMade + 1 < maxAttempts;
