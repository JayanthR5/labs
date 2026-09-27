type FetchLike = typeof fetch;

type SlackConnection = {
  accessToken: string;
  channelId: string | null;
};

type SlackLogger = {
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
};

type RedisSetLike = {
  set: (key: string, value: string, mode: "EX", seconds: number, condition: "NX") => Promise<string | null>;
};

export const claimRateLimitNotification = async (redis: RedisSetLike, key: string) =>
  redis.set(key, "1", "EX", 7200, "NX");

export const notifyRateLimit = async ({
  slack,
  senderEmail,
  hourlyLimit,
  sentCount,
  waitingCount,
  campaignId,
  fetchImpl = fetch,
  logger,
}: {
  slack: SlackConnection | null;
  senderEmail: string;
  hourlyLimit: number;
  sentCount: number;
  waitingCount: number;
  campaignId: string;
  fetchImpl?: FetchLike;
  logger: SlackLogger;
}) => {
  if (!slack?.channelId) {
    logger.info({}, "Slack not connected; skipping rate-limit notification.");
    return false;
  }
  try {
    const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${slack.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        channel: slack.channelId,
        text: `ReachInbox rate limit reached\n\nSender: ${senderEmail}\nHourly limit: ${hourlyLimit}\nEmails sent in current window: ${sentCount}\nCampaign: ${campaignId}\nEmails waiting: ${waitingCount}\nThe remaining emails have been rescheduled.`,
      }),
    });
    const payload = (await response.json()) as { ok?: boolean };
    if (!response.ok || payload.ok === false) throw new Error("Slack notification failed");
    return true;
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : "Slack API error" }, "Slack notification failed");
    return false;
  }
};