import { OFFICIAL_SKR_MINT } from "./promotional-pools-service.mjs";

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const DEFAULT_PRICE_MAX_AGE_MS = 5 * 60_000;

export function createPromotionPriceService({
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  apiBaseUrl = process.env.LUCKYME_JUPITER_PRICE_URL ?? "https://api.jup.ag/price/v3",
  apiKey = process.env.LUCKYME_JUPITER_API_KEY ?? "",
  cacheMs = 30_000,
  maxAgeMs = DEFAULT_PRICE_MAX_AGE_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Price service requires fetch");
  let cached = null;
  let cachedAt = 0;

  async function prices({ force = false } = {}) {
    if (!force && cached && clock() - cachedAt < cacheMs) return cached;
    const ids = [WRAPPED_SOL_MINT, OFFICIAL_SKR_MINT].join(",");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(`${apiBaseUrl}?ids=${encodeURIComponent(ids)}`, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Jupiter price HTTP ${response.status}`);
      const body = await response.json();
      const fetchedAt = new Date(clock()).toISOString();
      const parse = (asset, mint) => {
        const item = body?.[mint];
        const usdPrice = Number(item?.usdPrice);
        if (!Number.isFinite(usdPrice) || usdPrice <= 0) {
          throw new Error(`Jupiter did not return a reliable ${asset} price`);
        }
        return {
          asset,
          mint,
          usdPrice,
          blockId: Number.isFinite(Number(item.blockId)) ? Number(item.blockId) : null,
          decimals: Number.isFinite(Number(item.decimals)) ? Number(item.decimals) : null,
          source: "Jupiter Price API V3",
          fetchedAt,
          ageMs: 0,
          stale: false,
        };
      };
      cached = {
        SOL: parse("SOL", WRAPPED_SOL_MINT),
        SKR: parse("SKR", OFFICIAL_SKR_MINT),
      };
      cachedAt = clock();
      return cached;
    } catch (error) {
      if (!cached) throw error;
      const ageMs = clock() - cachedAt;
      return Object.fromEntries(Object.entries(cached).map(([asset, quote]) => [
        asset,
        { ...quote, ageMs, stale: ageMs > maxAgeMs, fallbackReason: String(error.message) },
      ]));
    } finally {
      clearTimeout(timer);
    }
  }

  async function quote(asset, options) {
    const normalized = String(asset ?? "").toUpperCase();
    const result = await prices(options);
    if (!result[normalized]) throw new Error("Price asset must be SOL or SKR");
    const ageMs = clock() - Date.parse(result[normalized].fetchedAt);
    return {
      ...result[normalized],
      ageMs,
      stale: Boolean(result[normalized].stale) || ageMs > maxAgeMs,
    };
  }

  return { prices, quote };
}
