console.error([
  "scripts/crank-empty-rounds.mjs is retired and cannot submit transactions.",
  "Idle rounds must remain unchanged until the first ticket starts their timer.",
  "For read-only legacy inventory use: npm run rent:recover:legacy-empty",
  "Any mainnet rent recovery still requires its dedicated two-flag approval flow.",
].join("\n"));

process.exitCode = 1;
