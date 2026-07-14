# LuckyMe Disaster Recovery

The Desktop backup named `Luckyme Back-up` is the recovery source corresponding
to the GitHub snapshot documented on 2026-07-14.

## Recovery order

1. Restore the repository and install the locked Node dependencies.
2. Restore the public web snapshot to `/var/www/luckyme/public`.
3. Restore the application source to `/opt/luckyme`.
4. Restore the Nginx and systemd files from the VPS configuration snapshot.
5. Restore the private API environment and runtime data with owner-only
   permissions.
6. Install and start the API first; verify `/health`, `/config`, and `/pools`.
7. Start the operations monitor and push timer.
8. Configure a keeper only after checking its public key against on-chain
   `KeeperConfig`; run a dry-run before enabling its timer.
9. Verify Nginx configuration before reload and confirm the public pages.
10. Install the preserved signed APKs rather than rebuilding during an incident.

## Backup contents

- complete Git repository and a portable Git bundle
- exact web source plus a read-only copy of the live public web directory
- Solana program, IDL, SDK, backend, keeper, monitor, deployment, and test code
- signed Seeker `1.1.7` / code `10` APK
- signed private Admin `1.0.0` / code `1` APK
- checksums, package metadata, certificate fingerprints, and service inventory
- sanitized VPS configuration and private runtime configuration/data kept
  outside the GitHub tree

## Security boundary

GitHub and the ordinary project source do not contain Solana keypairs, seed
phrases, Android signing keystores, Firebase service-account private keys,
Publisher Portal credentials, RPC secrets, or admin passwords.

The disaster backup does not duplicate the Solana keeper keypair or Android
signing private keys. If the keeper key is lost with a VPS, use the Ledger-held
upgrade/config authority to authorize a replacement keeper through the audited
configuration procedure. Never copy a seed phrase or private key into the
repository or a support message.

The Seeker signing credential remains EAS-managed. The existing signed APK can
be installed directly; publishing a later update requires access to the same
EAS signing identity. The private Admin APK can also be installed directly;
future Admin updates require its existing private signing identity.

## Mandatory checks after restore

- Program ID and Solana genesis hash match mainnet-beta.
- Config authority, treasury, and keeper public keys match this handoff.
- `ENABLE_TRANSACTION_SUBMIT=false`.
- API returns on-chain state rather than static fallback.
- Settlement preview has `DRY_RUN=true` and
  `CONFIRM_MAINNET_SETTLEMENT_KEEPER=false`.
- No keeper write occurs until simulation succeeds.
- Nginx admin routes require authentication and remain `no-store`/`noindex`.
- Push token storage and settlement archive have restricted filesystem access.
