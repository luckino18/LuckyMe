const BPS_DENOMINATOR = 10_000n;

export function calculateTreasuryEstimateLamports(totalLamports, houseFeeBps) {
  const total = parseUnsignedInteger(totalLamports, "totalLamports");
  const bps = parseUnsignedInteger(houseFeeBps, "houseFeeBps");
  if (bps > BPS_DENOMINATOR) throw new Error("houseFeeBps cannot exceed 10000");
  return ((total * bps) / BPS_DENOMINATOR).toString();
}

function parseUnsignedInteger(value, label) {
  const normalized = String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  return BigInt(normalized);
}
