import {
  ORAO_VRF_PROGRAM_ID,
  POOLS,
  PROGRAM_ID,
  accountExists,
  createClient,
  deriveConfig,
  deriveJackpotVault,
  deriveOraoRandomnessAccount,
  derivePool,
  derivePoolVault,
  deriveRound,
  deriveRoundRandomnessAccount,
  parseOraoRandomnessV2,
} from "./anchor-client.mjs";

const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const args = parseArgs(process.argv.slice(2));
const poolFilter = args.pool ? args.pool.toLowerCase() : null;
const roundFilter = args.round ? parsePositiveInteger(args.round, "round") : null;
const rpcUrl = process.env.ANCHOR_PROVIDER_URL || args.rpc || DEFAULT_MAINNET_RPC;
const poolSpecs = poolFilter
  ? POOLS.filter((pool) => pool.slug === poolFilter)
  : POOLS;

if (poolFilter && poolSpecs.length === 0) {
  throw new Error(`Unknown pool=${poolFilter}. Use one of: ${POOLS.map((pool) => pool.slug).join(", ")}`);
}

const { connection, program, url } = createClient({
  requireSigner: false,
  url: rpcUrl,
});
const config = deriveConfig();
const report = {
  checkedAt: new Date().toISOString(),
  clusterUrl: publicRpcUrl(url),
  programId: PROGRAM_ID.toBase58(),
  oraoProgramId: ORAO_VRF_PROGRAM_ID.toBase58(),
  config: config.toBase58(),
  configExists: await accountExists(connection, config),
  pools: [],
};

if (report.configExists) {
  try {
    const configAccount = await program.account.config.fetch(config);
    report.configState = {
      authority: configAccount.authority?.toBase58?.(),
      treasury: configAccount.treasury?.toBase58?.(),
      houseFeeBps: numberFromAnchor(configAccount.houseFeeBps),
      jackpotBps: numberFromAnchor(configAccount.jackpotBps),
      mainPrizeBps: 10_000 - numberFromAnchor(configAccount.houseFeeBps) - numberFromAnchor(configAccount.jackpotBps),
      jackpotOddsDenominator: numberFromAnchor(configAccount.jackpotOddsDenominator),
      roundDurationSeconds: numberFromAnchor(configAccount.roundDurationSecs),
      paused: Boolean(configAccount.paused),
    };
  } catch (error) {
    report.configFetchError = errorMessage(error);
  }
}

for (const poolSpec of poolSpecs) {
  const pool = derivePool(config, poolSpec.id);
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);
  const poolReport = {
    slug: poolSpec.slug,
    label: poolSpec.label,
    poolPda: pool.toBase58(),
    poolVault: poolVault.toBase58(),
    jackpotVault: jackpotVault.toBase58(),
    exists: await accountExists(connection, pool),
    poolVaultLamports: await safeBalance(poolVault),
    jackpotVaultLamports: await safeBalance(jackpotVault),
    rounds: [],
  };

  if (!poolReport.exists) {
    report.pools.push(poolReport);
    continue;
  }

  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = numberFromAnchor(poolAccount.currentRound);
  poolReport.currentRound = currentRound;
  poolReport.ticketPriceLamports = stringFromAnchor(poolAccount.ticketPriceLamports);
  poolReport.winnerCount = numberFromAnchor(poolAccount.winnerCount);
  poolReport.maxTicketsPerEntry = numberFromAnchor(poolAccount.maxTicketsPerEntry);

  const roundIds = roundFilter
    ? [roundFilter]
    : recentRoundIds(currentRound, Number(args.scan ?? process.env.LUCKYME_FORENSIC_SCAN_ROUNDS ?? 4));

  for (const roundId of roundIds) {
    const round = deriveRound(pool, roundId);
    const roundReport = {
      roundId,
      round: round.toBase58(),
      exists: await accountExists(connection, round),
    };

    if (!roundReport.exists) {
      poolReport.rounds.push(roundReport);
      continue;
    }

    const roundAccount = await program.account.round.fetch(round);
    const entries = await fetchEntriesForRound(program, round);
    const roundRandomness = deriveRoundRandomnessAccount(round);
    Object.assign(roundReport, {
      startTs: numberFromAnchor(roundAccount.startTs),
      endTs: numberFromAnchor(roundAccount.endTs),
      settled: Boolean(roundAccount.settled),
      totalTickets: stringFromAnchor(roundAccount.totalTickets),
      totalLamports: stringFromAnchor(roundAccount.totalLamports),
      entrantCount: numberFromAnchor(roundAccount.entrantCount),
      poolVaultBalanceLamports: await safeBalance(poolVault),
      entries: entries.map((entry) => ({
        address: entry.address.toBase58(),
        player: entry.player.toBase58(),
        ticketStart: entry.ticketStart.toString(),
        ticketCount: entry.ticketCount.toString(),
        ticketEndExclusive: entry.ticketEndExclusive.toString(),
        lamports: entry.lamports.toString(),
      })),
      roundRandomness: await randomnessReport(roundRandomness),
    });

    poolReport.rounds.push(roundReport);
  }

  report.pools.push(poolReport);
}

console.log(JSON.stringify(report, null, 2));

async function randomnessReport(roundRandomness) {
  const output = {
    sidecar: roundRandomness.toBase58(),
    exists: await accountExists(connection, roundRandomness),
  };

  if (!output.exists) {
    output.status = "not_requested";
    return output;
  }

  const sidecar = await program.account.roundRandomness.fetch(roundRandomness);
  const seed = Buffer.from(sidecar.randomnessSeed);
  const expectedRequest = deriveOraoRandomnessAccount(seed, ORAO_VRF_PROGRAM_ID);
  output.status = enumName(sidecar.status);
  output.provider = enumName(sidecar.provider);
  output.request = sidecar.request.toBase58();
  output.seed = seed.toString("hex");
  output.requestMatchesDerivedPda = sidecar.request.equals(expectedRequest);

  const providerAccount = await connection.getAccountInfo(sidecar.request, "confirmed");
  if (!providerAccount) {
    output.providerStatus = "missing";
    return output;
  }

  output.providerOwner = providerAccount.owner.toBase58();
  output.providerOwnerValid = providerAccount.owner.equals(ORAO_VRF_PROGRAM_ID);
  const parsed = parseOraoRandomnessV2(providerAccount.data);
  output.providerStatus = parsed.status;
  if (parsed.status === "fulfilled") {
    output.randomnessHash = parsed.randomnessHash.toString("hex");
  }
  if (parsed.status === "invalid") {
    output.providerError = parsed.error;
  }
  return output;
}

async function fetchEntriesForRound(program, round) {
  const accounts = await program.account.entry.all([
    {
      memcmp: {
        offset: 8,
        bytes: round.toBase58(),
      },
    },
  ]);

  return accounts
    .map(({ publicKey, account }) => {
      const ticketStart = bigintFromAnchor(account.ticketStart);
      const ticketCount = bigintFromAnchor(account.ticketCount);
      return {
        address: publicKey,
        player: account.player,
        ticketStart,
        ticketCount,
        ticketEndExclusive: ticketStart + ticketCount,
        lamports: bigintFromAnchor(account.lamports),
      };
    })
    .filter((entry) => entry.ticketCount > 0n)
    .sort((left, right) =>
      left.ticketStart < right.ticketStart ? -1 : left.ticketStart > right.ticketStart ? 1 : 0,
    );
}

async function safeBalance(address) {
  try {
    return String(await connection.getBalance(address, "confirmed"));
  } catch {
    return null;
  }
}

function recentRoundIds(currentRound, count) {
  const safeCount = Math.max(1, count);
  if (currentRound <= 0) {
    return [1];
  }
  const first = Math.max(1, currentRound - safeCount + 1);
  const output = [];
  for (let roundId = currentRound; roundId >= first; roundId -= 1) {
    output.push(roundId);
  }
  return output;
}

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("--")) {
      const [key, inline] = value.slice(2).split("=");
      output[key] = inline ?? values[index + 1];
      if (inline === undefined) {
        index += 1;
      }
    }
  }
  return output;
}

function numberFromAnchor(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value?.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value?.toString?.() ?? value);
}

function stringFromAnchor(value) {
  return value?.toString?.() ?? String(value ?? "");
}

function bigintFromAnchor(value) {
  if (typeof value === "bigint") {
    return value;
  }
  return BigInt(value?.toString?.() ?? value);
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function enumName(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return Object.keys(value)[0] ?? "unknown";
  }
  return String(value ?? "unknown");
}

function publicRpcUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
