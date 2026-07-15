# LuckyMe Discord alerts deployment — 2026-07-15

## Result

The LuckyMe Discord server has three production webhooks:

- `#rounds-live` for confirmed round starts and last-ten-minute reminders;
- `#round-results` for archived settlement and completed-refund results;
- private `#incidents` for operational alerts and recovery notices. The public
  `#status` channel is reserved for curated user-facing updates.

The scanner is a separate read-only systemd lane. It reads the public pools API,
the append-only settlement archive, and the protected operations-monitor snapshot.
It does not import a keeper signer, build transactions, submit transactions, or
participate in settlement/refund execution.

## Safety

- Webhook URLs are stored only in `/etc/luckyme/discord-webhooks.env` with mode
  `0600` and root ownership.
- Durable anti-duplication state is stored in
  `/var/lib/luckyme/discord-alerts.json` with mode `0600` and `luckyme` ownership.
- Existing settlement, push notification, operations-monitor, and API services
  were not stopped or restarted.
- Existing settlement history was baselined on first activation so old results
  are not reposted.

## Verification

- All three Discord webhook deliveries were verified.
- Local project suite: 152 of 152 tests passed.
- Production dry-run planned zero unexpected messages.
- `luckyme-discord-alerts.timer` is enabled and active with a 60-second interval.
- First live service run exited successfully with status `0`.
- API, settlement keeper timer, mobile push timer, and operations monitor timer
  remained active after deployment.
- No Solana transaction was sent.

Rollback backup: `/opt/backups/luckyme-discord-20260715T062551Z`.
