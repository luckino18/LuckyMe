# Final Release Evidence

Fill this file with the final production artifacts before submitting the APK in
the Publisher Portal.

| Field | Evidence |
| --- | --- |
| Mainnet program deploy tx | `Euf5ociVf2MyeyVpypC7EcwyQgnWBvsnuqhuxPGSMCeta9Ho1u7dKNGiLFczKbwkamjZMf8Ajb6Ykbj4mMXAP8N` |
| Initialized config tx | `67YRQtDcJwQJNoowzVaYhKRLNQEoi1n7GuDGNQKmGtXbYJubpGNGtL41YZpALkxe3opEBNkGx4kpUbsxLYj1yiEM` |
| Initialized pools txs | Mini `4Hv5KCbuiR2MLpwLfLJoF6YG1YfLMRXBCfSUQFTjDUofwvgAWTBp1sBYC38RbQqiCJWnx7NU9p59kSKxC7hLBmcp`; Normal `3y72EwzXsi1ygkVTagY4d1YuiL9W4gEsiS8bFKJufb9jrXcsQLjxE5GjSh6FKo9UdAHAxiireQThZAQ83qCw7Crw`; High `2BjYXJwAb8JKaqqz2rG1WzzG59XcrYeFKqo8ndFnexvk5c9h6jT3YwVJXYVaCkbLofmFJxMuVrVVD7dHA8Pb11bq`; Premium `2dtsjz8xcNkJ3yLr2hjTqgMiGQQqXemfBPUk6mhfBca4awWvLR6bPMw4LM3HEnCUPtyP26FbmUh67LKGRUGSobV1` |
| First active round txs | Mini `S3fgKmQGz4diURbQqas2zkwMXWVFEakRmwsYvM2DmLtVQYmYpPw8RBiipUMzVFzowhi5WgUmUNG8PQnvh6ixjQV`; Normal `sg6JikpXwQMh5d6t82bLLWt1P1Zv5uh5VkTeyXUKhvnFtMB4WkRp16qDqBn5h2oCAxWAVL38XDreGnCKx4eJoNs`; High `35zGdLDBgJuMfHaFeyee5us7WuynC7X3eaULijLe2W6US16GAxaBfNHouLP22yg1txi2SSpc3cvFzrQMLvGo6Gcv`; Premium `UUr1UEoHkzEmDDYLJ8VckWX4mvUUVczvJPvpCcfQLSURUrMhghWg1QSkpU6z7kp5wwJqcHZd2jmWtF6TH8t56UB` |
| Backend production HTTPS URL | `https://api.lucky-me.app` |
| Final signed APK artifact | `/Users/victor/Desktop/LuckyMe-Seeker-STORE-FINAL-2026-07-08.apk` |
| Final APK SHA-256 | `bb83e7f14f287fc0bd781d6cae4769ba94b2243565ab439e13455e5c176567e4` |
| EAS APK build URL | Local EAS build completed with remote Android credentials `Build Credentials iNPMBDRiCC (default)`. The queued cloud build `https://expo.dev/accounts/vvyktorrio/projects/luckyme-seeker/builds/d53bc7a1-0ace-4676-aa5b-8c8dda9ccb6c` was cancelled after the local store APK succeeded. |
| `apksigner verify --print-certs` output | Verified with APK Signature Scheme v2. Signer certificate SHA-256: `e249bc5555bb8206fc11dce9fcda527f25ddf8b8af00a0156806892a2cbb2067`; SHA-1: `7d840dbded97a42b3e59bacf1ffc31dc3ce0159f`; key: RSA 2048. |
| Android / Seeker phone smoke test | Victor reported the signed Seeker build tested on a Seeker phone on 2026-07-07. |
| Android / Seeker wallet test result | Pending post-deploy wallet entry test against active mainnet rounds. |
| Backend push notification deployment | Live `https://api.lucky-me.app/config` exposes Expo push registration at `/notifications/register` with max two round alerts per round. Live register/unregister smoke test passed and `npm run push:round-alerts` dry-run passed on the VPS. |

Notes:

- Use the synchronized Program ID:
  `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- Mainnet deployment confirmed on 2026-07-07. Upgrade authority is
  `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`; treasury is
  `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`.
- The final APK was built on 2026-07-08 with the `dapp-store` EAS profile.
- Record a real-device wallet-signing test result before Publisher Portal
  submission.
