const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const SHARED_PROVIDER_STATES = new Map();

const INFRASTRUCTURE_MESSAGE_RE =
  /(?:rate.?limit|too many requests|max(?:imum)? usage|quota|credits? exhausted|temporar(?:y|ily) unavailable|service unavailable|gateway timeout|timed? ?out|fetch failed|socket hang up|connection reset|econnreset|econnrefused|enotfound|node is behind|block height exceeded)/i;

export function rpcProvidersFromEnv(primaryUrl, env = process.env) {
  const configured = [
    ["primary", primaryUrl],
    ["shyft", env.LUCKYME_RPC_SHYFT_URL],
    ["chainstack", env.LUCKYME_RPC_CHAINSTACK_URL],
    ["alchemy", env.LUCKYME_RPC_ALCHEMY_URL],
    ...String(env.LUCKYME_RPC_FALLBACK_URLS ?? "")
      .split(",")
      .map((url, index) => [`fallback-${index + 1}`, url.trim()]),
  ];

  if (env.LUCKYME_RPC_PUBLIC_FALLBACK === "true") {
    configured.push(["solana-public", "https://api.mainnet-beta.solana.com"]);
  }

  const seen = new Set();
  return configured.flatMap(([name, rawUrl]) => {
    const url = String(rawUrl ?? "").trim();
    if (!url || seen.has(url)) return [];
    new URL(url);
    seen.add(url);
    return [{ name, url }];
  });
}

export function createRpcFailoverFetch({
  primaryUrl,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = positiveNumber(env.LUCKYME_RPC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  cooldownMs = positiveNumber(env.LUCKYME_RPC_COOLDOWN_MS, DEFAULT_COOLDOWN_MS),
  onEvent = () => {},
  shareHealthState = fetchImpl === globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const providers = rpcProvidersFromEnv(primaryUrl, env);
  if (providers.length === 0) throw new Error("At least one Solana RPC URL is required");
  const stateKey = providers.map(({ name, url }) => `${name}:${url}`).join("|");
  const state = shareHealthState
    ? sharedProviderState(stateKey)
    : { unavailableUntil: new Map(), preferredIndex: 0 };

  const rpcFetch = async (_input, init = {}) => {
    const startedAt = now();
    const candidates = orderedCandidates(providers, state.preferredIndex, state.unavailableUntil, startedAt);
    let lastFailure = null;

    for (const candidate of candidates) {
      try {
        const response = await fetchWithTimeout(fetchImpl, candidate.provider.url, init, timeoutMs);
        const retryable = await retryableResponse(response);
        if (!retryable) {
          state.preferredIndex = candidate.index;
          state.unavailableUntil.delete(candidate.provider.name);
          onEvent({ type: "success", provider: candidate.provider.name });
          return response;
        }

        lastFailure = new Error(`RPC ${candidate.provider.name} returned a retryable response`);
        state.unavailableUntil.set(candidate.provider.name, now() + cooldownMs);
        onEvent({ type: "failover", provider: candidate.provider.name, reason: "retryable_response" });
      } catch (error) {
        if (!isRetryableRpcError(error)) throw error;
        lastFailure = error;
        state.unavailableUntil.set(candidate.provider.name, now() + cooldownMs);
        onEvent({ type: "failover", provider: candidate.provider.name, reason: "transport_error" });
      }
    }

    throw new Error(
      `All configured Solana RPC providers are temporarily unavailable (${providers.map(({ name }) => name).join(", ")})`,
      { cause: lastFailure },
    );
  };

  rpcFetch.status = () => ({
    preferred: providers[state.preferredIndex]?.name ?? null,
    providers: providers.map(({ name }) => ({
      name,
      coolingDown: (state.unavailableUntil.get(name) ?? 0) > now(),
    })),
  });

  return rpcFetch;
}

function sharedProviderState(key) {
  let state = SHARED_PROVIDER_STATES.get(key);
  if (!state) {
    state = { unavailableUntil: new Map(), preferredIndex: 0 };
    SHARED_PROVIDER_STATES.set(key, state);
  }
  return state;
}

export function isRetryableRpcError(error) {
  if (error?.name === "AbortError") return true;
  return INFRASTRUCTURE_MESSAGE_RE.test(String(error?.message ?? error ?? ""));
}

async function retryableResponse(response) {
  if ([401, 403, 408, 425, 429].includes(response.status) || response.status >= 500) return true;
  if (!response.ok) return false;

  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!contentType.includes("json")) return false;
  try {
    const payload = await response.clone().json();
    const messages = Array.isArray(payload)
      ? payload.map((item) => item?.error?.message).filter(Boolean)
      : [payload?.error?.message].filter(Boolean);
    return messages.some((message) => INFRASTRUCTURE_MESSAGE_RE.test(String(message)));
  } catch {
    return false;
  }
}

function orderedCandidates(providers, preferredIndex, unavailableUntil, timestamp) {
  const indexed = providers.map((provider, index) => ({ provider, index }));
  const preferred = indexed.find(({ index }) => index === preferredIndex);
  const ordered = preferred
    ? [preferred, ...indexed.filter(({ index }) => index !== preferredIndex)]
    : indexed;
  const ready = ordered.filter(({ provider }) => (unavailableUntil.get(provider.name) ?? 0) <= timestamp);
  return ready.length > 0 ? ready : ordered;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener?.("abort", abortFromUpstream, { once: true });
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
