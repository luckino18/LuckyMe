import { createClient } from "./anchor-client.mjs";

function publicKeyText(value, label) {
  const text = value?.toBase58?.();
  if (typeof text !== "string" || text.length < 32 || text.length > 44) {
    throw new Error(`Invalid ${label} public key`);
  }
  return text;
}

function unsignedText(value, label) {
  const text = value?.toString?.() ?? String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`Invalid ${label}`);
  }
  return text;
}

export function attachEntryWallets(rounds, entryRecords) {
  const result = rounds.map((round) => ({ ...round, entries: [], walletCount: 0 }));
  const byRound = new Map(
    result
      .filter((round) => typeof round.roundAddress === "string" && round.roundAddress.length > 0)
      .map((round) => [round.roundAddress, round]),
  );

  for (const record of entryRecords) {
    const roundAddress = publicKeyText(record?.account?.round, "Entry round");
    const target = byRound.get(roundAddress);
    if (!target) continue;

    target.entries.push({
      address: publicKeyText(record.publicKey, "Entry account"),
      player: publicKeyText(record.account.player, "Entry player"),
      ticketStart: unsignedText(record.account.ticketStart, "ticket start"),
      ticketCount: unsignedText(record.account.ticketCount, "ticket count"),
      lamports: unsignedText(record.account.lamports, "Entry lamports"),
    });
  }

  for (const round of result) {
    round.entries.sort((left, right) => {
      const a = BigInt(left.ticketStart);
      const b = BigInt(right.ticketStart);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    round.walletCount = round.entries.length;
  }
  return result;
}

export async function loadEntryWallets(rounds, { rpcUrl, createClientImpl = createClient } = {}) {
  const { program } = createClientImpl({ requireSigner: false, url: rpcUrl });
  const records = await program.account.entry.all();
  return attachEntryWallets(rounds, records);
}
