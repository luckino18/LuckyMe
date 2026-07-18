import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LuckyMe cNFT metadata is wallet-display ready", async () => {
  const metadata = JSON.parse(await readFile(
    new URL("../site/lucky-me.app/cnft/luckyme-seeker-pass-v2.json", import.meta.url),
    "utf8",
  ));
  assert.equal(metadata.name, "LuckyMe Seeker Pass");
  assert.match(metadata.description, /Solana dApp Store/);
  assert.match(metadata.description, /Solana Seeker owners/);
  assert.doesNotMatch(JSON.stringify(metadata), /WIN|DOWNLOAD|VERIFY NFT|wallet signature|ENTER POOL|1 SOL/i);
  assert.match(metadata.image, /^https:\/\//);
  assert.match(metadata.image, /luckyme-seeker-pass-v2\.png$/);
  assert.equal(metadata.external_url, undefined);
  assert.equal(metadata.collection.name, "LuckyMe Seeker Pass");
  assert.equal(metadata.collection.family, "LuckyMe");
  assert.equal(metadata.properties.category, "image");
  assert.equal(metadata.properties.files[0].type, "image/png");
});

test("legacy test-mint URI serves the same neutral metadata", async () => {
  const canonical = JSON.parse(await readFile(
    new URL("../site/lucky-me.app/cnft/luckyme-seeker-pass-v2.json", import.meta.url),
    "utf8",
  ));
  const legacy = JSON.parse(await readFile(
    new URL("../site/lucky-me.app/cnft/luckyme-1-sol-draw.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(legacy, canonical);
});

test("campaign preparation script cannot sign or send", async () => {
  const source = await readFile(
    new URL("../scripts/seeker-cnft-campaign/prepare-cnft-campaign.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /sendAndConfirm|sendTransaction|signTransaction|keypairIdentity/);
  assert.match(source, /sentTransactions: 0/);
  assert.match(source, /public: false/);
});
