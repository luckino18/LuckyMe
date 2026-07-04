# Security Policy

LuckyMe is an experimental Solana devnet MVP. Do not use it with mainnet funds.

## Current Status

- The program has not been externally audited.
- The randomness design is an MVP commit-reveal flow. It has a no-reveal refund
  path, but it is not production-grade randomness.
- The economic model includes gambling-like mechanics and requires legal review
  before any real-money launch.
- There is no public bug bounty yet.

## Supported Scope

Security review currently covers the public `main` branch, the devnet program id
documented in the README, the local backend, and the Seeker app prototype.

Mainnet deployments, forks, unofficial frontends, private operator scripts, and
third-party RPC infrastructure are not supported by this policy.

## Reporting Issues

For non-sensitive bugs, open a GitHub issue.

For sensitive findings, use GitHub private vulnerability reporting on this
repository if it is available from the Security tab. If no private channel is
available, open a minimal public issue that only says a private security contact
is needed. Do not publish exploit details, proof-of-concept transactions, private
keys, or user-identifying data in a public issue.

Include:

- affected commit or deployed program id
- cluster and transaction signatures, if relevant
- impact and exploit preconditions
- minimal reproduction steps
- whether funds can be locked, redirected, or unfairly settled

## Severity Guide

- Critical: loss or theft of funds, arbitrary settlement manipulation, permanent
  vault lockup, upgrade-authority compromise, or private-key exposure.
- High: denial of settlement/refund, bypass of pause or treasury constraints,
  backend transaction-builder abuse with material user impact, or severe
  phishing surface.
- Medium: incorrect UI transaction review, incomplete accounting, weak
  operational controls, or missing tests for money-moving paths.
- Low: documentation gaps, minor hardening issues, or non-sensitive reliability
  problems.

## Response Targets

These are best-effort targets for the devnet MVP:

- Critical: acknowledge within 48 hours
- High: acknowledge within 5 business days
- Medium/Low: triage when project time allows

No SLA or bounty is promised until a production security program is announced.

## Incident Response

If a critical issue affects the devnet deployment:

1. Pause config if the bug affects buying or opening rounds.
2. Preserve transaction signatures, logs, build artifacts, and commit hashes.
3. Publish a short public status note without exploit details.
4. Patch, test locally, rebuild the IDL/SDK, and deploy only after verification.
5. Update `docs/handoff.md` with the exact fix, tests, deploy transaction, and
   residual risk.

Before any mainnet launch, LuckyMe needs a dedicated private contact, multisig
admin controls, a formal disclosure process, and a real bug bounty policy.
