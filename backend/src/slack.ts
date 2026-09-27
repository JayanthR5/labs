type FetchLike = typeof fetch;

export type SlackChannel = {
  id: string;
  name: string;
  isPrivate: boolean;
};

const slackApi = async <T>(url: string, token: string, fetchImpl: FetchLike = fetch): Promise<T> => {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Slack API request failed");
  const payload = (await response.json()) as T & { ok?: boolean };
  if (payload.ok === false) throw new Error("Slack API request failed");
  return payload;
};

export const slackOAuthUrl = (clientId: string, redirectUri: string, state: string) => {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "chat:write,channels:read,groups:read",
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
};

export const exchangeSlackCode = async ({
  clientId,
  clientSecret,
  redirectUri,
  code,
  fetchImpl = fetch,
}: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  fetchImpl?: FetchLike;
}) => {
  const response = await fetchImpl("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!response.ok) throw new Error("Slack authorization failed");
  const payload = (await response.json()) as {
    ok?: boolean;
    access_token?: string;
    team?: { id?: string; name?: string };
  };
  if (!payload.ok || !payload.access_token || !payload.team?.id) throw new Error("Slack authorization failed");
  return {
    accessToken: payload.access_token,
    teamId: payload.team.id,
    teamName: payload.team.name ?? "Slack workspace",
  };
};

export const listSlackChannels = async (token: string, fetchImpl: FetchLike = fetch): Promise<SlackChannel[]> => {
  const channels: SlackChannel[] = [];
  for (const types of ["public_channel", "private_channel"]) {
    const payload = await slackApi<{ channels?: Array<{ id?: string; name?: string; is_private?: boolean }> }>(
      `https://slack.com/api/conversations.list?types=${types}&limit=200`,
      token,
      fetchImpl,
    );
    for (const channel of payload.channels ?? []) {
      if (channel.id && channel.name) channels.push({ id: channel.id, name: channel.name, isPrivate: Boolean(channel.is_private) });
    }
  }
  return channels;
};