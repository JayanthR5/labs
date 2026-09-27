import { describe, expect, it, vi } from "vitest";
import { exchangeSlackCode, slackOAuthUrl } from "../src/slack";

describe("Slack OAuth", () => {
  it("generates an OAuth URL with encoded state and redirect URI", () => {
    const url = new URL(slackOAuthUrl("client-id", "http://localhost:4000/api/slack/callback", "state-value"));
    expect(url.hostname).toBe("slack.com");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4000/api/slack/callback");
    expect(url.searchParams.get("scope")).toContain("chat:write");
  });

  it("exchanges a valid authorization code without exposing the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, access_token: "secret-token", team: { id: "T1", name: "Workspace" } }), { status: 200 }));
    const result = await exchangeSlackCode({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost/callback", code: "code", fetchImpl });
    expect(result).toEqual({ accessToken: "secret-token", teamId: "T1", teamName: "Workspace" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsuccessful authorization response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "invalid_code" }), { status: 200 }));
    await expect(exchangeSlackCode({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost/callback", code: "expired", fetchImpl })).rejects.toThrow("Slack authorization failed");
  });
});