import { Keypair } from "@solana/web3.js";
import { createSignInMessage } from "@solana/wallet-standard-util";
import nacl from "tweetnacl";

const baseUrl = (process.env.SEEKER_REFERRAL_SMOKE_URL ?? "https://api.lucky-me.app").replace(/\/$/, "");
const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  ...(process.env.SEEKER_REFERRAL_SMOKE_PROXY_HEADER === "true"
    ? { "X-Forwarded-Proto": "https" }
    : {}),
};

const nonceResponse = await fetch(`${baseUrl}/api/seeker/nonce`, {
  method: "POST",
  headers,
  body: "{}",
});
const nonce = await nonceResponse.json().catch(() => ({}));
if (!nonceResponse.ok || !nonce.payload) {
  console.error(JSON.stringify({ stage: "nonce", status: nonceResponse.status, error: nonce.error ?? "invalid_response" }));
  process.exit(1);
}

const wallet = Keypair.generate();
const signedMessage = createSignInMessage({
  ...nonce.payload,
  address: wallet.publicKey.toBase58(),
});
const signature = nacl.sign.detached(signedMessage, wallet.secretKey);
const verifyResponse = await fetch(`${baseUrl}/api/seeker/verify-siws`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    payload: nonce.payload,
    output: {
      publicKey: Buffer.from(wallet.publicKey.toBytes()).toString("base64"),
      signature: Buffer.from(signature).toString("base64"),
      signedMessage: Buffer.from(signedMessage).toString("base64"),
    },
    hasPendingReferral: false,
  }),
});
const verify = await verifyResponse.json().catch(() => ({}));
const result = {
  nonceStatus: nonceResponse.status,
  verifyStatus: verifyResponse.status,
  verifyError: verify.error ?? null,
};
console.log(JSON.stringify(result));

// The generated wallet intentionally has no SGT. Reaching NO_SGT proves the
// nonce, SIWS message, public key, signature and mainnet SGT lookup all ran.
if (verifyResponse.status !== 403 || verify.error !== "no_sgt") process.exit(1);
