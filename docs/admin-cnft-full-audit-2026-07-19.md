# LuckyMe Admin NFT sender — full audit 2026-07-19

## Result

Local release candidate complete. Production deployment and the final zero-broadcast VPS audit are pending.

## Trigger and production state

- Visible error: `Cannot access 'transactions' before initialization`.
- Failure occurred during preparation, before wallet signing and before broadcast.
- Zero transactions and zero NFTs were submitted by this attempt.
- The selected production batch of 100 usernames remained reserved and must be released only after a registry backup.

## Corrected end-to-end contract

1. Resolve and validate at most 100 distinct recipients for one operator approval.
2. Reject unresolved names, duplicate wallets and active holders of the official non-burned pass.
3. Build 34 Bubblegum transactions for 100 recipients, with at most three mints per transaction.
4. Pace and simulate all 34 transactions with bounded retry and authority-debit limits.
5. Rebuild the exact instruction plans with a fresh shared blockhash after simulations.
6. Ask Solflare once to sign the complete 34-transaction set.
7. Validate every returned transaction, authority signature and reviewed semantic mint plan; accept only bounded Solflare Compute Budget/Lighthouse protection additions and restore reviewed order.
8. Persist the job and each expected signature before contacting the broadcast RPC.
9. Broadcast one cNFT tree mutation at a time and confirm it before submitting the next.
10. Stop safely before blockhash expiry and reconcile exact attempted signatures on-chain without automatic retransmission.
11. Mark only confirmed assets as sent; release only exact never-submitted or definitively failed recipients.
12. Recover interrupted attempted jobs from the Admin page using a read-only chain audit.

## Verification

- Syntax validation passed for server, mint tool, Admin client and no-broadcast audit.
- Focused NFT/SKR regression tests: `24/24` passed.
- Exact capacity test: `100 recipients -> 34 signed transactions -> one wallet approval` passed.
- Complete repository suite: `206` executed, `195` passed. The remaining `11` were blocked before assertions because this Codex sandbox denies local HTTP listeners with `EPERM`; no executable logic assertion failed.
- `git diff --check` passed.

## Required production sequence

1. Back up `/var/lib/luckyme/admin-skr-registry.json`, the cNFT job store, deployed service scripts and Admin static files.
2. Record the current registry totals and recent service audit log.
3. Release the exact stale 100-name reservation; do not alter confirmed records.
4. Deploy the audited server/tool/registry/UI/systemd environment changes.
5. Restart `luckyme-admin-cnft` and verify its unprivileged write access to `/var/lib/luckyme`.
6. Run the no-broadcast 100-recipient audit. Acceptance is exactly 100 recipients, 34 prepared transactions, zero signatures, zero broadcasts, zero mints and a clean reservation release.
7. Only after those checks may the operator start a new real batch. Never retry the failed browser job.

## Deployment blocker in this session

Remote command execution is unavailable in the current Codex tool session, so no VPS file was replaced and no production service was restarted. The production tool must remain treated as blocked until the required sequence above is completed and verified.
