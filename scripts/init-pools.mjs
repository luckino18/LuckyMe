import {
  BN,
  POOLS,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
} from "./anchor-client.mjs";

const { connection, payer, program, url } = createClient();
const config = deriveConfig();
const treasury = payer.publicKey;
const roundDurationSecs = Number(process.env.LUCKYME_ROUND_DURATION_SECS ?? 300);

console.log(`Cluster: ${url}`);
console.log(`Authority: ${payer.publicKey.toBase58()}`);
console.log(`Config: ${config.toBase58()}`);

if (!(await accountExists(connection, config))) {
  const signature = await program.methods
    .initializeConfig(treasury, 300, 200, 288, new BN(roundDurationSecs))
    .accounts({
      authority: payer.publicKey,
      config,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`Initialized config: ${signature}`);
} else {
  console.log("Config already exists");
}

for (const poolSpec of POOLS) {
  const pool = derivePool(config, poolSpec.id);
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);

  if (await accountExists(connection, pool)) {
    console.log(`${poolSpec.label} pool already exists: ${pool.toBase58()}`);
    continue;
  }

  const signature = await program.methods
    .initializePool(poolSpec.id, poolSpec.ticketPriceLamports)
    .accounts({
      authority: payer.publicKey,
      config,
      pool,
      poolVault,
      jackpotVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`Initialized ${poolSpec.label} pool: ${pool.toBase58()} (${signature})`);
}
