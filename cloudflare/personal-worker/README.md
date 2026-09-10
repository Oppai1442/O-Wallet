# O-Wallet Personal Cloud Worker

This Worker is an optional, user-owned companion for O-Wallet. It runs in the user's own Cloudflare account.

## What v1 does

- Public `/health` endpoint
- Authenticated `/v1/capabilities` endpoint
- KV-backed cron heartbeat every 15 minutes
- Reports future capabilities without pretending they are active yet

O-Wallet financial records, passwords, recovery codes, DEKs, and bank images are not sent to this Worker in v1.

## Setup

1. Create a Cloudflare Worker from this template.
2. Create a KV namespace and bind it as `STATE`.
3. Replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.jsonc` if you deploy with Wrangler.
4. Create a Worker secret named `PAIRING_TOKEN`. Use a strong random value of at least 24 characters.
5. Keep `ALLOWED_ORIGIN=https://oppai1442.github.io` unless you self-host O-Wallet elsewhere.
6. Deploy the Worker.
7. In O-Wallet, open **Settings → Personal Cloud**, paste the Worker URL and the same pairing token, then choose **Pair & connect**.

With Wrangler:

```bash
npm install
npx wrangler kv namespace create STATE
npx wrangler secret put PAIRING_TOKEN
npm run deploy
```

The pairing token is stored by O-Wallet only as a vault-encrypted local secret and is not synchronized to Google Drive.
