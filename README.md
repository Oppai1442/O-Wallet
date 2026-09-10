# O-Wallet

O-Wallet is a private, local-first expense tracker built as a static React PWA.

**Live app:** https://oppai1442.github.io/O-Wallet/  
**O-Project:** https://oppai1442.github.io/O-Project

Current release: **v0.19.1**

O-Wallet does not require an O-Project-owned transaction backend. The browser performs encryption, decryption, OCR, parsing, analytics, local persistence and Google Drive synchronization. Financial records and screenshots are encrypted before they are written to Drive.

The optional **Personal Cloud** feature is different: users may deploy a companion Cloudflare Worker into **their own Cloudflare account** for future background automation. Personal Cloud is optional and does not replace the local-first data model.

---

## What O-Wallet currently does

### Personal finance

- Expense, income and transfer transactions.
- Multiple accounts with editable names and user-defined account groups/catalogues.
- Unlimited-depth category trees; organizational parent nodes are not selectable as transaction categories.
- Transactions may remain uncategorized until the user classifies them.
- Monthly category budgets.
- Tags, search, filters, edit and duplicate actions.
- Batch transaction creation across multiple selected dates.
- Recurring batch generation by weekday through a selected end date.
- Future-dated generated transactions are stored and synced immediately but are excluded from current balances, budgets and analytics until their occurrence time.
- Dashboard and analytics with date-range filtering, cash-flow summaries, category charts and budget progress.

### Fast input

#### Guided voice entry

Voice entry is field-by-field rather than free-form sentence parsing. This keeps recognition narrow and predictable:

- Vietnamese (`vi-VN`) and English (`en-US`) recognition profiles.
- Configurable field order.
- Defaults for fields such as type/date/time/account can be accepted without speaking.
- Field-specific parsers for spoken amounts, dates and times.
- Account/category matching uses the user's existing data and complete category paths.
- Accent calibration stores bounded transcript correction pairs, not microphone audio.
- Mobile: tap the central `+` button for normal entry; hold it to open Voice Entry and start listening immediately.

O-Wallet uses the browser Speech Recognition API. Depending on the browser/platform, speech recognition may be processed by the browser vendor rather than fully on-device.

#### Screenshot OCR

Normal OCR uses Tesseract.js in the browser:

- Vietnamese + English recognition.
- User-defined spatial regions.
- Teaching mode for mapping detected text lines to transaction fields.
- Move/resize/relabel region editing.
- Optional inline-label stripping such as `Nội dung:` / `Recipient:`.
- Named OCR templates encrypted inside normal synced settings.
- Multi-image OCR review queue with one draft transaction per screenshot.
- Semantic duplicate warnings and exact-match deselection by default.
- OCR automation rules can map recipient/description/amount/type patterns to a category and/or account.

Third-party executable OCR assets are not persisted in O-Wallet's service-worker runtime cache. Fully offline **first-run** OCR is therefore not guaranteed.

#### Optional AI image reading

AI reading is **off by default**. The reference build supports OpenRouter for user-selected screenshots:

- API key is encrypted locally with the current vault key.
- API key is device-local and is not synced to Google Drive.
- Endpoint/model configuration may sync because it is not secret.
- Only images the user explicitly submits are sent to the external AI provider.
- AI output is treated as untrusted input and normalized before use.

Normal Tesseract OCR remains independent of the AI path.

### Import and export

- Decrypted JSON export as an explicit local action.
- CSV export with spreadsheet-formula prefix neutralization.
- Money Manager Android `.mmbak` / SQLite import.
- SQLite parsing runs in a browser Web Worker; the original backup is not uploaded to O-Wallet or Google Drive.
- Import includes account/category mapping, transfer-pair handling, duplicate detection and explicit handling for ambiguous source semantics.

---

## Google Drive sync

O-Wallet uses Google Identity Services and the restricted Drive scope:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

It intentionally does **not** request unrestricted full-Drive access.

Each user's visible Drive folder contains encrypted O-Wallet data:

```text
O-Wallet/
├─ vault.json
├─ records/*.owr
└─ images/*.owi
```

`vault.json` contains salts, KDF parameters and wrapped keys. Transaction records and image contents are encrypted payloads.

Synchronization includes:

- per-entity UUID/version/timestamp/device metadata;
- tombstones for deletions;
- a persistent local dirty queue;
- bounded parallel uploads;
- Google Drive Changes API cursors for incremental sync;
- lazy encrypted screenshot download on secondary devices;
- fallback to rediscovery/full reconciliation if cached Drive metadata becomes invalid;
- protection against silently overwriting a different O-Wallet vault already present in the selected Drive.

### Google session behavior

The active Google bearer token is stored only in `sessionStorage`. O-Wallet does not persist the bearer token in long-lived local storage.

The default Google remember preference is currently **30 days**, but that longer-lived state contains account/reconnect metadata rather than the bearer token. On startup O-Wallet attempts a silent Google reconnect when remembered metadata is valid. Browser/Google policy can still require explicit interaction.

A valid token survives F5 in the same tab.

---

## Vault encryption and recovery

O-Wallet generates a random 256-bit Data Encryption Key (DEK). Records and images use AES-256-GCM.

Password path:

```text
password
  -> PBKDF2-HMAC-SHA256, 600,000 iterations + random salt
  -> password KEK
  -> AES-GCM wrapped DEK
```

Recovery path:

```text
random recovery key
  -> domain-separated SHA-256
  -> recovery KEK
  -> AES-GCM wrapped DEK
```

Security-question answers are a separate verification layer. They are **not** used as encryption keys; the random recovery key remains the cryptographic recovery secret.

New encrypted record/image payloads use authenticated additional data (AAD) tied to the expected entity identity, so moving valid ciphertext to a different record/image identity fails authentication.

See [SECURITY.md](./SECURITY.md) for the threat model and limitations.

---

## Quick Unlock

Quick Unlock is a **per-device convenience layer** configured from:

```text
Settings -> Sync & security -> Quick Unlock
```

The password remains the canonical fallback and is still required for a new device/restore path.

O-Wallet uses WebAuthn/platform authenticators:

- Android/iOS/macOS-capable authenticators may use WebAuthn PRF when available, deriving the local wrapping key from authenticator output.
- Windows uses a Windows Hello/platform-user-verification compatibility path because PRF support is inconsistent across Windows Hello/browser combinations.
- Quick Unlock configuration is tied to the current vault and relying-party origin and is never synced to Drive.

The Windows/platform-UV fallback is a weaker cryptographic boundary than PRF: its local non-extractable AES wrapping key is protected by browser storage and the application flow, while Windows Hello supplies user verification. This should be treated as convenience against casual access, **not** as protection from malicious JavaScript or a compromised browser profile. See `SECURITY.md` for details.

Vault remembered-unlock and Quick Unlock are separate mechanisms. Remembered vault unlock remains **off by default**.

---

## Shared Wallets

Shared Wallets provide multi-user ledgers without one shared writable Drive root:

- each member owns their encrypted member feed in their own Drive;
- other members receive read access to ciphertext rather than write access to another member's feed;
- shared transactions carry stable creator attribution;
- normal edit/delete rights are limited to the creator's own feed;
- the owner maintains encrypted membership/control data;
- removing an active member archives their current feed before group-key rotation;
- invitations use a high-entropy transport secret, not the group key itself;
- the initial key ring remains inside an account-restricted registration file;
- Google Picker is used in the join flow so O-Wallet can retain the narrow `drive.file` scope;
- each member maintains an encrypted personal safety snapshot for read-only recovery scenarios;
- member nicknames are private aliases stored in each user's own encrypted settings.

Shared Wallets require `VITE_GOOGLE_API_KEY` for Google Picker/public encrypted shared-file reads. The key is browser configuration, not a secret, and should be restricted by HTTP referrer and API in Google Cloud.

---

## Personal Cloud — experimental

Personal Cloud is an optional user-owned Cloudflare Worker companion available in Settings.

v1 currently implements only the infrastructure layer:

```text
GET /health
GET /v1/capabilities   # bearer-authenticated
KV state
Cron heartbeat every 15 minutes
```

The Settings UI can store a Worker URL, pair with a Worker using a pairing token, test connectivity, show Worker/capability state and disconnect the local pairing.

The pairing token is encrypted as a **device-local O-Wallet secret** with the current vault key. Worker URL/capability/heartbeat metadata may be stored locally as ordinary non-secret configuration.

Personal Cloud v1 does **not** currently send transactions, balances, passwords, recovery codes, DEKs or bank screenshots to the Worker. Planned capabilities such as Automation Inbox, push notifications and scheduled actions are displayed as unavailable until implemented.

Cloudflare's Deploy-to-Cloudflare importer is currently treated as **experimental** in this project. The Worker source lives under `cloudflare/personal-worker/`, with a root `wrangler.jsonc` for deployment. If the hosted importer cannot read the repository, manual Wrangler deployment remains the deterministic fallback.

---

## PWA and local storage

O-Wallet is installable as a PWA.

The service worker precaches the built application shell (`js`, `css`, `html`, local images/icons/fonts/WASM) and immediately adopts new releases with `skipWaiting` + `clientsClaim`. Third-party OCR runtime resources are intentionally excluded from persistent Workbox runtime caching.

IndexedDB stores encrypted wallet records/images plus the metadata needed for sync and local operation. This means ordinary wallet use does not require re-downloading the complete Drive dataset every time the app opens.

Clearing browser/site data can remove the local copy and device-only secrets. Drive data remains unless the user separately deletes it from Drive.

---

## Settings organization

Settings are split into focused sections rather than one long page:

```text
General
Personal wallet
Input & AI
Sync & security
Personal Cloud
Data & app
```

Wallet and input sections contain additional sub-tabs for defaults/accounts/categories/budgets/rules and voice/OCR/AI/import respectively.

---

## Architecture

```text
                       optional
                user's Cloudflare account
                 Personal Cloud Worker
                       ^
                       | pairing / capability metadata
                       |
GitHub Pages           |
static app             |
    |                  |
    v                  |
+---------------- user device ----------------+
| React PWA                                  |
| IndexedDB                                  |
| AES-GCM encryption/decryption              |
| Tesseract OCR                              |
| transaction parsing                        |
| analytics                                  |
| sync engine                                |
+--------------------+------------------------+
                     |
                     | OAuth access token
                     | Google Drive API
                     v
              user's Google Drive
                 O-Wallet/
```

Optional external paths exist only when invoked/configured by the user:

```text
Voice Entry -> browser Speech Recognition implementation
AI Reading  -> OpenRouter / selected model provider
Personal Cloud -> user's own Cloudflare Worker
```

---

## Security hardening

The production build includes:

- restrictive Content Security Policy;
- `Referrer-Policy: no-referrer`;
- runtime frame-embedding guard for GitHub Pages;
- stronger `_headers` template for hosts that support response headers;
- AES-GCM AAD identity binding;
- vault/KDF parameter validation before expensive cryptographic work;
- file-signature, byte-size, decoded-image-pixel, OCR-output and SQLite import limits;
- remote Drive payload size limits;
- allowlisted external URLs and Google profile-image hosts;
- no production source maps;
- source checks rejecting `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, broad Drive scope and obvious private-key/client-secret material;
- exact-pinned package versions;
- CI `npm audit` vulnerability gate;
- CodeQL and Dependabot configuration;
- post-build secret/CSP/source-map checks;
- AES-GCM/AAD tamper smoke test.

O-Wallet is still browser software: malicious JavaScript served from a compromised deployment, a malicious extension, device malware or a compromised dependency can act with the privileges of the unlocked application. Encryption at rest does not solve runtime compromise.

No independent cryptographic/security audit has been completed. Do not describe the project as high-assurance financial software.

---

## Current limitations / unfinished work

- Bank-specific built-in OCR packs beyond user-created templates.
- Import/restore from O-Wallet decrypted JSON/CSV exports and more third-party formats.
- Automated end-to-end tests against real Google Drive accounts.
- Password-change and recovery-key rotation UI.
- Large-history sync compaction/indexing work.
- Remote tombstone/expired-image cleanup.
- Independent security review.
- Fully self-hosted OCR language/runtime assets for guaranteed offline first-run OCR.
- Personal Cloud background automation, push and inbox execution.
- Personal Cloud one-click hosted importer reliability depends on Cloudflare's external deployment service.

---

# Local development

Requirements:

- Node.js `^20.19.0` or `>=22.12.0`
- npm

```bash
cp .env.example .env
npm install
npm run dev
```

Required browser build configuration:

```env
VITE_GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-public-google-api-key
```

`VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` are browser-visible configuration. **Never add a Google OAuth client secret to this repository.** Restrict the API key by HTTP referrer/API in Google Cloud.

## Google Cloud setup

Enable:

```text
Google Drive API
Google Picker API
```

Create an OAuth 2.0 Client ID with application type **Web application**.

Authorized JavaScript origins contain only the origin:

```text
http://localhost:5173
https://<username>.github.io
```

Do not append `/O-Wallet/` to the Authorized JavaScript origin.

For the reference deployment, configure Google Auth Platform branding/privacy/terms URLs to match the final host. The included `privacy.html` and `terms.html` are templates and should be reviewed by anyone publishing their own fork.

---

# Validation and build

```bash
npm run security:check
npm run build
npm run security:dist
```

or:

```bash
npm run check
```

The GitHub Pages workflow additionally installs dependencies with lifecycle scripts disabled, runs the vulnerability gate and publishes only after the checks/build succeed.

This repository intentionally does not currently commit `package-lock.json`; CI resolves a lock for the run because of a prior Vite/Rolldown optional-dependency lock issue. This trades away some reproducibility. Revisit this decision when the dependency/tooling issue is no longer relevant.

### What CI does not test

The current automated checks do **not** replace browser/device smoke testing for:

- Google OAuth popup/silent reconnect behavior;
- first-time vs existing-Drive onboarding;
- WebAuthn/Windows Hello/fingerprint/Face ID behavior;
- microphone permission and browser speech recognition;
- Google Picker/shared-wallet cross-account flows;
- real Cloudflare Worker provisioning.

Those flows should be exercised manually on the target browser/device matrix before a public release.

---

# GitHub Pages deployment

The repository includes GitHub Actions for Pages deployment and CodeQL. A push to `main` builds and deploys the reference app after the configured checks pass.

Recommended repository controls:

- passkey/2FA on maintainer accounts;
- branch protection/ruleset for `main`;
- required CI/security checks before merge;
- restricted direct push access;
- review `.github/workflows/` changes as application code;
- keep Dependabot and CodeQL/security alerts enabled.

---

## License

GNU General Public License v3.0. See [LICENSE](./LICENSE).
