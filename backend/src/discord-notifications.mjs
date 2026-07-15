const DISCORD_API_LIMIT = 2_000;

export async function sendDiscordWebhook(
  webhookUrl,
  message,
  { dryRun = true, fetchImpl = fetch } = {},
) {
  if (!webhookUrl) {
    return { ok: true, skipped: true, reason: "webhook_not_configured" };
  }
  validateDiscordWebhookUrl(webhookUrl);
  const payload = normalizeDiscordMessage(message);
  if (dryRun) {
    return { ok: true, dryRun: true, planned: 1, sent: 0 };
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook delivery failed with HTTP ${response.status}`);
  }
  return { ok: true, dryRun: false, planned: 1, sent: 1 };
}

export function validateDiscordWebhookUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["discord.com", "discordapp.com"].includes(url.hostname) ||
    !/^\/api\/webhooks\/[^/]+\/[^/]+$/.test(url.pathname)
  ) {
    throw new Error("Invalid Discord webhook URL");
  }
  return value;
}

function normalizeDiscordMessage(message) {
  const content = String(message?.content ?? "").trim();
  if (!content) throw new Error("Discord message content is required");
  if (content.length > DISCORD_API_LIMIT) {
    throw new Error(`Discord message exceeds ${DISCORD_API_LIMIT} characters`);
  }
  return {
    content,
    allowed_mentions: { parse: [] },
  };
}
