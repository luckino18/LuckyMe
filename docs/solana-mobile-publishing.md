# Solana Mobile Publishing

This checklist follows the official Solana Mobile dApp Store publishing docs.

## Before Submission

- Build a release-ready APK signed with the release key.
- Prepare app metadata: name, description, screenshots, and icon.
- Use a Solana browser-extension wallet with enough SOL for submission
  transactions and storage upload costs.
- Review the Publisher Policy and Developer Agreement.

## Publisher Portal

- Create a Publisher Account.
- Complete KYC/KYB.
- Connect the publisher wallet and keep access to it.
- Set a storage provider for APK and asset uploads.
- Add LuckyMe app details.
- Create the first release version, upload the APK, and submit.
- Approve required wallet signing prompts during submission.

## Optional CLI Publish Path

Prerequisites:

- app already created in the Publisher Portal;
- App NFT minted;
- release-ready signed APK;
- Solana signer keypair file;
- Publisher Portal API key.

Command:

```bash
npm install -g @solana-mobile/dapp-store-cli
export DAPP_STORE_API_KEY=<publisher-portal-api-key>
dapp-store \
  --apk-file ./app-release.apk \
  --keypair ./publisher-keypair.json \
  --whats-new "$(cat docs/store-listing/whats-new-v1.0.0.txt)"
```

The CLI maps the Android package name in the APK to the app under the publisher
account.

## Not Specified By Solana Mobile Docs

The cited Solana Mobile docs do not list these as universal submission
artifacts:

- third-party smart-contract audit report;
- written legal opinion;
- uploaded gambling license.

The Publisher Policy still requires compliant content, transactions, and
user-data disclosures.
