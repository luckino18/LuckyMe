const CANCELLED_ERROR_RE =
  /cancel(?:led|lation)|cancellationexception|user rejected|user declined|request rejected/i;
const TECHNICAL_ERROR_RE =
  /(?:^|\b)(?:java\.|android\.|com\.|org\.|exception\b|stack trace|econn|enet|fetch failed|network request failed|failed to connect|aborterror|rpc error|json-rpc)/i;

export function userFacingError(error: unknown, fallback: string): string {
  const detail = error instanceof Error
    ? error.message.trim()
    : typeof error === "string"
      ? error.trim()
      : "";

  if (!detail) return fallback;
  if (CANCELLED_ERROR_RE.test(detail)) return "Wallet request was cancelled.";
  if (TECHNICAL_ERROR_RE.test(detail) || detail.length > 180) return fallback;
  return detail;
}
