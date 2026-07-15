import { Buffer } from "@craftzdog/react-native-buffer";

export class WalletOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletOutputError";
  }
}

function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) return null;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return new Uint8Array(Buffer.from(padded, "base64"));
  } catch {
    return null;
  }
}

function recoverProtocolBase64(bytes: Uint8Array, expectedLength?: number) {
  // @wallet-ui/react-native-web3js 4.2 converts MWA's base64 protocol fields
  // to UTF-8 bytes. Seed Vault therefore yields 88 ASCII bytes for a 64-byte
  // Ed25519 signature. Decode that protocol representation back to raw bytes.
  if (expectedLength && bytes.length === expectedLength) return bytes;
  if (bytes.length < 4 || bytes.some((byte) => byte > 0x7f)) return bytes;
  const encoded = Buffer.from(bytes).toString("ascii");
  const decoded = decodeBase64(encoded);
  if (!decoded || decoded.length === 0) return bytes;
  if (expectedLength && decoded.length !== expectedLength) return bytes;
  return decoded;
}

export function walletResultBytes(value: unknown, field: string, expectedLength?: number) {
  let bytes: Uint8Array;
  if (value instanceof Uint8Array) {
    bytes = value;
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    bytes = Uint8Array.from(value);
  } else if (typeof value === "string") {
    const decoded = decodeBase64(value);
    if (!decoded) throw new WalletOutputError(`Wallet returned invalid ${field} encoding`);
    bytes = decoded;
  } else {
    throw new WalletOutputError(`Wallet returned an invalid ${field}`);
  }

  bytes = recoverProtocolBase64(bytes, expectedLength);
  if (expectedLength && bytes.length !== expectedLength) {
    throw new WalletOutputError(`Wallet returned an invalid ${field} length`);
  }
  return bytes;
}
