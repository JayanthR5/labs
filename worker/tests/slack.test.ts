import { describe, expect, it, vi } from "vitest";
import { claimRateLimitNotification, notifyRateLimit } from "../src/slack";

const logger = { info: vi.fn(), warn: vi.fn() };

describe("Slack rate-limit notifications", () => {
  it("claims only the first notification in a sender window", async () => {
    const redis = { set: vi.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null) };
    await expect(claimRateLimitNotification(redis, "email-rate-notified:sender-1:1")).resolves.toBe("OK");
    await expect(claimRateLimitNotification(redis, "email-rate-notified:sender-1:1")).resolves.toBeNull();
    expect(redis.set).toHaveBeenCalledWith("email-rate-notified:sender-1:1", "1", "EX", 7200, "NX");
  });

  it("skips safely when Slack is not connected", async () => {
    const result = await notifyRateLimit({ slack: null, senderEmail: "sender@example.com", hourlyLimit: 1, sentCount: 1, waitingCount: 1, campaignId: "campaign-1", fetchImpl: vi.fn(), logger });
    expect(result).toBe(false);
    expect(logger.info).toHaveBeenCalledWith({}, "Slack not connected; skipping rate-limit notification.");
  });

  it("sends one notification through the selected channel", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const result = await notifyRateLimit({ slack: { accessToken: "token", channelId: "C1" }, senderEmail: "sender@example.com", hourlyLimit: 1, sentCount: 1, waitingCount: 2, campaignId: "campaign-1", fetchImpl, logger });
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://slack.com/api/chat.postMessage", expect.objectContaining({ method: "POST", body: expect.stringContaining("Emails waiting: 2") }));
  });

  it("does not throw when Slack API fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 200 }));
    const result = await notifyRateLimit({ slack: { accessToken: "token", channelId: "C1" }, senderEmail: "sender@example.com", hourlyLimit: 1, sentCount: 1, waitingCount: 1, campaignId: "campaign-1", fetchImpl, logger });
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});