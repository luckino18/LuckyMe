const REFUND_INSTRUCTION_LOG = "Program log: Instruction: RefundEntryAfterTimeout";

export function isConfirmedRefundTransaction(transaction, intent) {
  try {
    if (!transaction?.meta || transaction.meta.err !== null) {
      return false;
    }

    const accountKeys = transactionAccountKeys(transaction);
    const requiredAddresses = [
      intent.programId,
      intent.address,
      intent.entry,
      intent.player,
    ];
    if (requiredAddresses.some((address) => !address || !accountKeys.includes(address))) {
      return false;
    }

    const logs = transaction.meta.logMessages ?? [];
    if (!logs.includes(REFUND_INSTRUCTION_LOG)) {
      return false;
    }

    const entryIndex = accountKeys.indexOf(intent.entry);
    const playerIndex = accountKeys.indexOf(intent.player);
    const preBalances = transaction.meta.preBalances ?? [];
    const postBalances = transaction.meta.postBalances ?? [];
    if (
      entryIndex < 0 ||
      playerIndex < 0 ||
      preBalances[entryIndex] === undefined ||
      postBalances[entryIndex] === undefined ||
      preBalances[playerIndex] === undefined ||
      postBalances[playerIndex] === undefined
    ) {
      return false;
    }

    const entryRent = BigInt(String(preBalances[entryIndex]));
    const entryAfter = BigInt(String(postBalances[entryIndex]));
    const playerDelta = BigInt(String(postBalances[playerIndex])) -
      BigInt(String(preBalances[playerIndex]));
    const principal = BigInt(String(intent.lamports));

    return entryRent > 0n && entryAfter === 0n && playerDelta === principal + entryRent;
  } catch {
    return false;
  }
}

function transactionAccountKeys(transaction) {
  const message = transaction.transaction?.message;
  const staticKeys = message?.staticAccountKeys ?? message?.accountKeys ?? [];
  const loaded = transaction.meta?.loadedAddresses ?? {};
  return [
    ...staticKeys,
    ...(loaded.writable ?? []),
    ...(loaded.readonly ?? []),
  ].map(publicKeyText);
}

function publicKeyText(value) {
  const key = value?.pubkey ?? value;
  return key?.toBase58?.() ?? String(key ?? "");
}
