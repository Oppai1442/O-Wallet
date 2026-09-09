# O-Wallet

O-Wallet is a private, local-first expense tracker built as a static PWA.

**No O-Wallet runtime backend is required.** The production deployment is static HTML/CSS/JS. The browser performs OCR, encryption, analytics and sync; encrypted cloud data is stored in the user's own Google Drive.

Current release: **v0.13.1**

## Highlights

- React + Vite + TypeScript + Tailwind CSS.
- Installable PWA with mobile bottom navigation and desktop sidebar.
- Vietnamese and English UI. Vietnamese copy uses neutral, plain-language product wording for regular users.
- IndexedDB via Dexie; transaction and image payloads are AES-256-GCM ciphertext.
- Google Identity Services + Google Drive API with `drive.file`.
- Visible `O-Wallet/` folder in each user's own Google Drive.
- Incremental cross-device sync with UUID + version + timestamp + device ID + tombstones, a persistent dirty queue, bounded parallel uploads and Google Drive change cursors.
- Google session survives reload within the current tab. Longer remember windows persist only reconnect metadata; after a new browser session Drive reconnect is explicit, avoiding background OAuth popup flashes.
- Optional per-device remembered vault unlock (15 minutes to 30 days); default remains password-on-reload.
- Local account switching clears only browser-side O-Wallet data and never deletes the Drive folder.
- Tesseract.js OCR runs in the browser with Vietnamese + English recognition assets and can parse user-selected spatial regions.
- OCR regions are editable after creation: move, resize, change semantic field, and optionally strip inline labels such as `Nội dung:` / `Recipient:`.
- OCR teaching mode lists detected text lines and lets the user explain what each line represents; those semantic mappings become reusable spatial regions.
- OCR region templates can be named, encrypted in synced settings and reused across devices.
- Multi-image OCR creates one draft transaction per screenshot, provides a review/repair queue, and saves selected drafts in one pass.
- Semantic duplicate detection warns about likely duplicate OCR imports; exact matches are skipped by default until the user explicitly re-selects them.
- Screenshot bytes are encrypted directly; images are **not** converted to base64 before encryption. Secondary devices download image bytes lazily when an image is opened.
- Dashboard and analytics with range filters, cash-flow charts, category pie charts and monthly budget progress.
- Advanced transaction search/filtering, tags, edit and duplicate actions.
- Account groups (catalogues), editable account names and removable accounts.
- Unlimited-depth category trees. Parent nodes are organizational groups; only leaf items are selectable on transactions.
- Category picker searches the complete route, so typing `mua` can match paths such as `Y tế › Mua thuốc`.
- OCR automation rules can map recipient/description/amount/type patterns to a category and/or account.
- v0.8.0 redesign uses a quieter neutral visual system with a finance-oriented dashboard hierarchy.
- Batch transaction creation: pick many calendar dates in one pass with one shared time.
- Recurring batch generation by weekday through a chosen end date. Future generated transactions are stored and synced immediately, but balances, budgets and analytics ignore them until their occurrence time.
- Decrypted JSON/CSV export is available as an explicit local action.
- Local import from other apps. v0.7.0 includes a Money Manager Android backup adapter for `.mmbak` / SQLite files; parsing runs inside a browser Web Worker and the original backup is never uploaded to O-Wallet.
- Privacy Policy and Terms of Service pages included for public OAuth deployments.
- Footer links to **O-Lab**, the project hub at `https://oppai1442.github.io/all/`.




## v0.13.1 UX / state fixes

- Transactions may be saved without a category; they appear as **Uncategorized / Chưa phân loại** until the user assigns one.
- Newly created accounts/categories/settings are reflected in the open UI immediately instead of waiting for a reload.
- Voice entry is exposed as a first-class shortcut in the shell, while shared wallets remain a dedicated navigation page.
- A valid Google token survives F5 in the same tab. After a new browser session, O-Wallet no longer attempts a background OAuth popup; reconnect is explicit when Drive access is needed.
- The PWA service worker now takes over new releases immediately (`skipWaiting` + `clientsClaim`) to reduce stale-build confusion after deploy.

## v0.13.0 guided voice entry

O-Wallet can now fill a transaction one field at a time with browser speech recognition. The design intentionally avoids whole-sentence commands: each step has a narrow context, shows the current/default value, and lets the user press **Next** without speaking when the default is already correct.

- Vietnamese (`vi-VN`) and English (`en-US`) recognition profiles.
- Configurable field order in Settings. Type/date/time/account defaults can be accepted immediately; required fields remain explicit.
- Guided flow with **Back**, **Next**, retry, and direct manual editing for the current field.
- Fast field-specific parsers for spoken amounts, dates and times, including common Vietnamese number/date/time phrases.
- Account/category speech matching is biased toward the user's existing data; category matching uses the full hierarchy path.
- A lightweight accent calibration asks the user to read short finance-oriented samples. O-Wallet stores only transcript correction pairs, not audio, and applies those corrections before parsing later speech.
- Where the browser supports contextual speech phrases, O-Wallet boosts relevant account/category/calibration vocabulary. The feature gracefully falls back when contextual biasing is unavailable.
- Speech settings and accent corrections are encrypted inside normal synced O-Wallet settings. Voice audio itself is never stored by O-Wallet.
- Browser speech recognition availability and processing behavior depend on the browser/device. Some implementations may use the browser vendor's speech service rather than fully local recognition.

## v0.12.0 shared wallets

Shared wallets add multi-user ledgers without introducing an O-Wallet backend or one writable Drive root that every member can destroy.

- Every shared transaction stores a stable `createdByMemberId`. The creator is always visible in the shared transaction list and only that creator can edit/delete their own transaction.
- Each member owns an encrypted **member feed** in their own Google Drive. Other members receive read-only access to the encrypted bytes, so one member does not get write permission over another member's feed or storage folder.
- The owner keeps a small encrypted control file containing membership and feed references. When an active member is removed, O-Wallet first freezes that member's current feed into an owner-owned encrypted archive, then rotates the current group key. Remaining members receive the new key through per-member encrypted envelopes, while historical keys remain available only to read older/frozen data.
- Each member maintains a small encrypted personal safety snapshot of the merged ledger in their own Drive. If the owner's live control data disappears, the latest snapshot can still be shown read-only.
- Member nicknames are **personal aliases**. They are stored only in the current user's encrypted personal settings, sync only with that user's own O-Wallet data, and are never written to the shared wallet. Different members may therefore give the same person different nicknames.
- Invitations are sent to a Google email address. The owner creates a tiny encrypted registration file shared only to that Google account, and Google Drive sends the notification email with an O-Wallet join link. The link carries a random transport secret, **not the group key**; the initial group key ring remains inside the account-restricted registration file. The Drive permission is also given the same expiration time as the invitation.
- O-Wallet continues to request `drive.file`, not unrestricted Drive access. On join, Google Picker is used once to explicitly make the exact invitation/registration file available to O-Wallet for the invited account. A forwarded link by itself is therefore insufficient to recover the group key.
- Shared control/feed files are link-readable **ciphertext**. Content is encrypted client-side with group keys; the public read permission exists only to make narrow cross-account reads possible without broad Drive scope.

Shared Wallets need a public Google API key in addition to the OAuth client ID. The key is browser configuration, not a secret, and should be restricted by HTTP referrer and API in Google Cloud.




## v0.11.0 optional AI image reading

O-Wallet can optionally send a user-selected screenshot directly from the browser to OpenRouter for multimodal extraction. There is still no O-Wallet application backend in this path.

- AI is **off by default**. Endpoint, model and API key fields start blank; the UI only shows examples/placeholders.
- The reference build allows the OpenRouter Chat Completions endpoint (`https://openrouter.ai/api/v1/chat/completions`) so the production CSP stays restrictive.
- The user chooses a vision-capable OpenRouter model.
- The OpenRouter API key is AES-GCM encrypted with the unlocked vault key and stored only in local IndexedDB on that device. It is never added to Drive sync.
- Endpoint/model configuration is stored in encrypted O-Wallet settings and may sync to other devices; each device must enter its own API key.
- Pressing **Read with AI** sends the selected image to OpenRouter/model provider. Normal Tesseract OCR remains local-only.
- AI results are treated as untrusted suggestions, normalized, and then passed through the same local transaction-rule logic before being shown to the user.

OpenRouter vision requests use the standard Chat Completions API with text + `image_url` content. The implementation also requests `provider.data_collection = "deny"`.

## v0.10.0 security hardening

v0.10.0 hardens the browser/client boundary without adding an O-Wallet backend. The core privacy model remains the same: Google handles identity and per-user Drive storage; O-Wallet handles encryption locally.

- Production Content Security Policy restricts scripts, connections, frames, workers, images and other executable/resource origins to the minimum set currently required by O-Wallet, Google Identity/Drive and OCR runtime assets.
- O-Wallet refuses to render inside another page/iframe as a GitHub Pages-compatible clickjacking guard. A stronger `frame-ancestors 'none'` header template is included for hosts that support custom response headers.
- `Referrer-Policy: no-referrer` is applied to the static page and sensitive Google/Drive fetches use `no-store` and `no-referrer`.
- Google OAuth continues to use only `drive.file`; active bearer tokens remain tab/session scoped, while long remember periods store reconnect metadata only.
- New AES-GCM payloads are format v2 and bind ciphertext to `record:<kind>:<id>` or `image:<id>` with authenticated additional data. Moving a valid ciphertext blob to a different entity/record kind therefore fails authentication. Existing v1 payloads remain readable.
- Vault configuration is validated before expensive KDF work; hostile iteration counts, malformed IV/key envelopes, oversized configs and invalid recovery metadata are rejected.
- New vaults use PBKDF2-HMAC-SHA256 at 600,000 iterations for the password path. Security-question answers use their own salted PBKDF2 verifier; they remain only an additional recovery check, while the random recovery key is the actual cryptographic recovery secret.
- Image and SQLite imports validate size, extension/type and file signatures before processing. Images also enforce decoded-pixel limits; SQLite parsing runs in a Worker with a timeout and row/string caps. OCR output is bounded before it is retained by the app.
- Remote Drive record/image downloads have strict byte limits and remote sync metadata is validated before use.
- CSV export neutralizes spreadsheet formula prefixes (`=`, `+`, `-`, `@`) to reduce formula-injection surprises when a user opens the export in spreadsheet software.
- External URLs are allowlisted and opened with `noopener,noreferrer`; Google profile images are accepted only from HTTPS `googleusercontent.com` hosts.
- Production builds explicitly disable source maps. The service worker no longer keeps a separate persistent cache of third-party executable OCR assets.
- CI now runs source security invariants, an AES-GCM/AAD tamper smoke test, a high-severity `npm audit` gate, a post-build secret/CSP/source-map scan, weekly CodeQL and Dependabot configuration.

GitHub Pages cannot apply arbitrary HTTP response headers from this repository. O-Wallet therefore uses a CSP meta policy plus an in-app frame guard there. `public/_headers` contains the stronger equivalent headers for compatible static hosts such as Cloudflare Pages.


## v0.9.0 incremental Drive sync

Drive synchronization was redesigned for wallets with larger histories and screenshot collections.

- The first sync still performs one complete reconciliation so upgrades and new devices are safe.
- After that, O-Wallet stores a Google Drive Changes API cursor and asks Drive only for files changed since the previous sync.
- Local edits are written to a persistent IndexedDB sync queue, so later syncs do not scan every local record just to discover what changed.
- Record/image uploads run through a bounded pool of five concurrent Drive requests instead of one request at a time.
- Drive folder/file IDs are cached locally and reused; renamed O-Wallet folders continue to work because IDs are stable.
- Screenshot bytes are lazy on secondary devices. Sync downloads image metadata only; encrypted image bytes are fetched and cached when the user actually opens that image. Transactions and settings therefore become usable without waiting for a large image library.
- The vault config is no longer rewritten on every sync when it has not changed.
- If a cached Drive layout is removed or a Drive change cursor becomes invalid, O-Wallet falls back to rediscovery/full reconciliation automatically.

This keeps the existing per-entity UUID/version/timestamp/device conflict model while making steady-state sync proportional to the number of changes rather than the total wallet size.

## v0.8.1 shell layout and URL state

- Desktop/tablet navigation is pinned to the viewport and no longer scrolls away with long Settings or other pages.
- The main content area owns its own vertical scroll; sidebar actions stay reachable.
- The footer is bottom-aligned on short pages and follows content normally on long pages instead of floating upward.
- Top-level destinations are reflected in the URL with `?page=home`, `?page=transactions`, `?page=analytics`, and `?page=settings`.
- The add-transaction dialog uses `&action=add`, so refresh/back-forward state is deterministic.
- Browser Back/Forward updates the active O-Wallet section without a full reload.

## v0.8.0 account, category and rule model

### Accounts

Accounts are ordinary user data. They may be renamed, grouped into user-created catalogues, archived/removed and recreated. O-Wallet no longer treats `Ví chính` / `Main wallet` as a protected system account. If an older account with that name exists, it behaves exactly like any other account.

### Categories

New vaults start with **no categories**. Category nodes support unlimited nesting:

```text
Y tế
└─ Thuốc
   └─ Mua thuốc
```

Only leaf items can be assigned to transactions. Group nodes exist only to organize the tree. Existing old flat categories remain compatible and are treated as leaf items. Unused legacy built-in categories from pre-v0.8 vaults are removed automatically; categories already referenced by transactions, budgets or defaults are preserved.

### Automation rules

Rules live inside encrypted synced settings. A rule can match one or more of:

- recipient contains text;
- description contains text;
- exact amount;
- transaction type.

A matching rule can assign a category and/or account after OCR. Rules are evaluated on-device; no rule content is sent to an O-Wallet backend.

## Architecture

```text
GitHub Pages / static host
        │
        ▼
┌──────────────── user device ────────────────┐
│ React PWA                                   │
│                                            │
│ IndexedDB ciphertext                       │
│ OCR (Tesseract.js)                         │
│ transaction parser                         │
│ analytics                                  │
│ AES-GCM encryption / decryption            │
│ sync engine                                │
└──────────────────┬─────────────────────────┘
                   │ OAuth access token
                   │ Drive API
                   ▼
           user's own Google Drive
             O-Wallet/
             ├─ vault.json
             ├─ records/*.owr
             └─ images/*.owi
```

`vault.json` contains cryptographic configuration such as salts and wrapped keys. Financial records and image contents are encrypted payloads.

## Current V1/V0.x scope

Implemented:

- encrypted vault setup and password unlock;
- recovery key + security-question verification layer;
- encrypted IndexedDB records and images;
- per-user Google Drive folder creation and encrypted binary sync;
- expense, income and transfer transactions;
- multiple accounts with user-defined account groups;
- unlimited-depth hierarchical categories with no built-in category set for new vaults;
- editable/removable accounts (including older `Ví chính` / `Main wallet` starter accounts);
- local OCR screenshot import with heuristic transaction prefill, inline-label cleanup and common Vietnamese bank date formats;
- OCR teaching workflow for assigning detected lines to amount/time/recipient/balance/description semantics;
- editable OCR regions with move/resize/relabel controls;
- multi-image OCR review queue with one transaction per image and semantic duplicate warnings;
- encrypted image preservation and viewer;
- dashboard and analytics;
- light / dark / system themes;
- Vietnamese / English language switch;
- configurable image retention;
- synced language/theme/default-account/default-category/remember-duration preferences;
- monthly category budgets;
- transaction tags, edit/duplicate and advanced filters;
- OCR spatial region selection + reusable encrypted templates;
- local JSON/CSV export;
- local Money Manager `.mmbak` / SQLite migration with account/category mapping, transfer-pair collapsing, duplicate detection and safe handling of ambiguous balance-adjustment rows;
- rule-based OCR classification using recipient, description, amount and transaction type;
- PWA manifest/service worker;
- GitHub Actions Pages deployment workflow;
- public `privacy.html` and `terms.html`;
- automatic Drive pull immediately after restoring/unlocking on a new device;
- protection against accidentally overwriting a different O-Wallet vault already present in the selected Drive.

Still intentionally early-stage / remaining production work:

- bank-specific prebuilt semantic pattern packs beyond user-created templates;
- import/restore from decrypted JSON/CSV exports and additional third-party app formats;
- automated end-to-end integration tests against Google Drive;
- password-change and recovery-key rotation flows;
- sync compaction/indexing for very large histories;
- remote tombstone / expired-image cleanup;
- independent cryptographic/security review before making high-assurance claims;
- self-hosted OCR runtime/language assets if fully offline **first-run** OCR is required.

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

`npm install` also installs `sql.js`, which O-Wallet uses to read supported SQLite backup files locally in the browser. No SQLite server or native runtime is required.

Set:

```env
VITE_GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-public-google-api-key
```

`VITE_GOOGLE_API_KEY` is used by Shared Wallets for Google Picker and public reads of encrypted shared files. It is also public browser configuration; restrict it in Google Cloud by HTTP referrer and API.

The Vite variables are build-time configuration. A Google OAuth **Client ID is public information** in a browser app; do not put a Google OAuth `client_secret` in this project.

---

# Self-deploy to GitHub Pages

The repository includes:

```text
.github/workflows/deploy.yml
.github/workflows/codeql.yml
.github/dependabot.yml
```

The deploy workflow resolves a lock for the run, installs dependencies with lifecycle scripts disabled, executes security checks/audit, builds, scans `dist/`, and only then uploads the Pages artifact. For strongest reproducibility, generate and commit `package-lock.json` once from a trusted machine after dependency review:

```bash
npm install --package-lock-only --ignore-scripts
git add package-lock.json
git commit -m "Lock dependencies"
```

After configuration, a push to `main` automatically builds and deploys the app to GitHub Pages.

## 1. Fork or create a repository

Example:

```text
https://github.com/<username>/O-Wallet
```

The resulting GitHub Pages URL is typically:

```text
https://<username>.github.io/O-Wallet/
```

O-Wallet's Vite config uses `base: './'`, so a repository-specific Vite base path is not required for normal GitHub project pages.

If the default branch is not `main`, edit `.github/workflows/deploy.yml`.

## Recommended GitHub repository security

Code cannot enforce account/repository settings. For a public deployment, also enable these in GitHub:

- passkey or 2FA on maintainer accounts;
- branch protection/ruleset for `main`;
- require the build/security checks before merge;
- restrict who can push to `main`;
- review changes to `.github/workflows/` like application code;
- keep Dependabot and CodeQL/security alerts enabled.

## 2. Create a Google Cloud project

Open Google Cloud Console and create/select a project for the deployment.

Enable:

```text
Google Drive API
Google Picker API
```

Official Drive API documentation:

https://developers.google.com/workspace/drive/api/guides/about-sdk

## 3. Configure Google Auth Platform

Configure the OAuth consent screen / Google Auth Platform branding.

Suggested values for a GitHub Pages deployment:

```text
Application name:
O-Wallet

Application home page:
https://<username>.github.io/<repo>/

Application privacy policy link:
https://<username>.github.io/<repo>/privacy.html

Application terms of service link:
https://<username>.github.io/<repo>/terms.html

Authorized domain:
<username>.github.io
```

The included privacy and terms pages are **templates for the reference architecture**. A fork/deployer should review and customize the operator/contact wording before presenting them as its own policy.

If Google asks for proof that the deployment domain is controlled by the developer, follow Google Search Console / OAuth domain-verification instructions for that deployment.

## 4. Configure Audience

During private development, the app can stay in Testing and specific Google accounts can be added as test users.

To let arbitrary eligible Google accounts authorize the app, switch the app to the appropriate production/published status in Google Auth Platform. Depending on the scopes, branding and current Google policies, Google may require additional verification.

Do not work around verification by requesting broader Drive permissions.

## 5. Configure Data Access / scopes

O-Wallet requests:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

`drive.file` is intentional. O-Wallet should manage files it creates or files the user explicitly makes available to the app rather than requesting arbitrary full-Drive access.

Official OAuth scope documentation:

https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## 6. Create OAuth Client ID

Create:

```text
OAuth 2.0 Client ID
Application type: Web application
```

Add Authorized JavaScript origins.

For local development:

```text
http://localhost:5173
```

For GitHub Pages:

```text
https://<username>.github.io
```

Important: **Authorized JavaScript origins contain only the origin.** Do not append the repository path.

Correct:

```text
https://example.github.io
```

Incorrect:

```text
https://example.github.io/O-Wallet/
```

If the app is served from a custom domain, add that custom HTTPS origin instead/as well.

## 7. Add the GitHub Actions variable

In the GitHub repository:

```text
Settings
→ Secrets and variables
→ Actions
→ Variables
→ New repository variable
```

Create:

```text
Name:
VITE_GOOGLE_CLIENT_ID

Value:
<your OAuth web client ID>.apps.googleusercontent.com
```

This is a **repository variable**, not a secret. The value is embedded in the built JavaScript and is visible to browser users by design.

Never add a Google OAuth client secret to frontend code, GitHub Pages output or a `VITE_*` variable.

## 8. Enable GitHub Pages with GitHub Actions

Repository:

```text
Settings
→ Pages
→ Build and deployment
→ Source
→ GitHub Actions
```

Then push to `main`:

```bash
git add .
git commit -m "Deploy O-Wallet"
git push
```

Watch:

```text
Repository → Actions
```

The workflow performs:

```text
npm install
npm run build
upload dist/
deploy Pages
```

No local `npm run build` is required for this deployment flow.

## 9. Verify OAuth URLs after deployment

For a repository named `O-Wallet`, verify these pages are public:

```text
https://<username>.github.io/O-Wallet/
https://<username>.github.io/O-Wallet/privacy.html
https://<username>.github.io/O-Wallet/terms.html
```

Then test Google authorization from the deployed origin.

If Google reports `no registered origin` / `401 invalid_client`, compare the browser value of:

```js
location.origin
```

against the exact Authorized JavaScript origins configured for the OAuth Web Client.

---

# Google Drive data ownership

Under this architecture, each user authorizes O-Wallet against that user's Google account. O-Wallet writes the encrypted files into that user's own Drive and quota.

Typical layout:

```text
My Drive/
└─ O-Wallet/
   ├─ vault.json
   ├─ records/
   │  ├─ <uuid>.owr
   │  └─ ...
   └─ images/
      ├─ <uuid>.owi
      └─ ...
```

The folder is visible so the user can see what is consuming Drive storage and can delete it manually if O-Wallet is no longer used.

---

# Crypto model

```text
password
  -> PBKDF2-SHA256
  -> KEK
  -> unwrap random 256-bit DEK

recovery key
  -> SHA-256 domain-separated key
  -> recovery KEK
  -> unwrap the same DEK

DEK
  -> AES-256-GCM transaction JSON
  -> AES-256-GCM image binary containers
```

Security questions are **not** treated as high-entropy cryptographic recovery secrets. They are an additional recovery UX verification step; the random recovery key remains the actual recovery secret.

Images are handled as binary bytes:

```text
image Blob
  -> ArrayBuffer / bytes
  -> AES-GCM
  -> encrypted binary file
```

No pre-encryption base64 expansion is required.

---

# Session and device convenience settings

O-Wallet separates Google authorization from vault unlocking. Both are per-device convenience settings:

```text
Google connection
  off | current tab | 1h | 8h | 1d | 7d | 30d

Vault unlock
  password after reload (default) | 15m | 1h | 8h | 1d | 7d | 30d
```

The Google access token itself is short-lived. Active bearer tokens are stored only in `sessionStorage`, which fixes ordinary F5/reload logout in the same tab. Longer windows store only account + reconnect metadata in `localStorage`. O-Wallet renews silently shortly before expiry, retries a remembered session several times after reload/expiry, and retries again on `focus` / `online`. If Google requires interaction, the UI changes to **Reconnect required** instead of pretending Drive is disconnected.

Remembered vault unlock is intentionally **off by default**. When enabled, the browser persists the non-extractable DEK `CryptoKey` in IndexedDB on that device. This is a convenience/security trade-off and should not be enabled on shared devices.

The **Switch Google account on this device** action removes the local vault config, encrypted local cache, account binding and remembered unlock state. It does **not** delete the user's `O-Wallet/` folder on Drive.

# Privacy summary

- The reference architecture has no central O-Wallet financial-data backend.
- Financial data and image payloads are encrypted client-side before Drive upload.
- The Google OAuth bearer token is kept in `sessionStorage`, not long-lived `localStorage`. Longer remember windows persist only account/reconnect metadata. Silent renewal is retried automatically, but long windows remain best-effort because a static frontend has no refresh-token backend.
- Vault auto-unlock is disabled by default. If explicitly enabled, the non-extractable DEK `CryptoKey` is stored in IndexedDB on that device until the selected expiry.
- Google Drive still sees storage/sync metadata such as file sizes, modification times and application metadata needed for merging.
- The static host and Google remain third-party infrastructure providers and may process normal network/account metadata under their own policies.
- The selected UI language is stored locally in browser storage and is not treated as sensitive data.

See:

```text
public/privacy.html
public/terms.html
SECURITY.md
ARCHITECTURE.md
```

---

# Tiếng Việt — triển khai nhanh

1. Fork/đẩy source lên GitHub.
2. Tạo Google Cloud project và bật **Google Drive API**.
3. Cấu hình Google Auth Platform: Branding, Audience, Data Access.
4. Tạo **OAuth Client ID → Web application**.
5. Authorized JavaScript origins:
   - `http://localhost:5173`
   - `https://<username>.github.io`
6. Thêm GitHub repository variable `VITE_GOOGLE_CLIENT_ID`.
7. Vào **Settings → Pages → Source → GitHub Actions**.
8. Push branch `main`; workflow tự build và deploy.
9. Với public OAuth, điền homepage/privacy/terms bằng URL GitHub Pages và publish app theo yêu cầu của Google.
10. Không đưa `client_secret` vào frontend.

Giao diện hỗ trợ **Tiếng Việt / English**. Phần tiếng Việt dùng cách diễn đạt trung lập, phù hợp cho ứng dụng public.

## Importing from another app

Open **Settings → Import data from another app** and choose a supported backup file. The original file is read into memory on the current device and parsed in a dedicated Web Worker; it is not uploaded to an O-Wallet backend. Once confirmed, the converted entities are saved like normal O-Wallet data, encrypted locally, and can then sync to the user's own Google Drive.

The first adapter targets the Android Money Manager backup schema identified by the `ASSETS`, `INOUTCOME`, and `ZCATEGORY` tables. Supported file extensions include `.mmbak`, `.db`, `.sqlite`, and `.sqlite3`.

Current Money Manager mapping:

- normal income and expense rows become O-Wallet income/expense transactions;
- Money Manager's mirrored transfer rows are collapsed into one O-Wallet transfer rather than imported twice;
- deleted source rows are ignored;
- accounts and categories can be merged with existing O-Wallet items by name;
- source IDs are retained as import metadata so importing the same backup again updates records originating from that backup instead of blindly duplicating them;
- O-Wallet also runs its normal semantic duplicate detector against existing non-imported transactions;
- ambiguous Money Manager balance-adjustment groups are skipped by default. The import review shows examples and lets the user explicitly treat each group as income or expense if they know what those records mean.

Money Manager `.mmbak` files can contain **photo references without the actual JPEG/PNG bytes**. In that case O-Wallet imports the transaction but cannot reconstruct its old attachment from the backup file alone.

The importer code is adapter-oriented (`src/lib/importers/` + a worker), so additional third-party formats can be added without putting app-specific SQLite parsing into the main wallet data layer.

## v0.7.0 external backup import notes

- Added local SQLite backup parsing through `sql.js` in a module Web Worker.
- Added a Money Manager Android adapter for accounts, categories, normal transactions, mirrored transfers, tags when present, and attachment metadata.
- Added preview, date-range summary, duplicate controls, category/account merge options, and an explicit review path for ambiguous balance adjustments.
- Imported source IDs are stored on each migrated transaction for deterministic re-import/update behavior.
- The SQL.js WASM asset is included in PWA precaching so the importer can work after it has been fetched by the installed build.

## v0.5.0 notes

- Add transaction now supports **Once**, **Multiple dates**, and **Repeat** creation modes.
- Multiple-date mode uses a built-in multi-select calendar and one shared time for all selected dates.
- Repeat mode selects weekdays, a start date, an end date and a shared time, then materializes the matching transactions immediately.
- Batch writes are encrypted and committed in chunks, followed by one refresh/sync notification instead of one refresh per record.
- Future transactions remain visible in the transaction list with a Future/Scheduled badge, but are excluded from balances, budgets, dashboard summaries and analytics until their occurrence time passes.
- Current-time calculations refresh periodically and on tab focus/visibility changes, so a scheduled transaction becomes effective without requiring a full page reload.

## v0.4.0 notes

This release expands the app beyond the initial core:

- three responsive navigation/layout modes: phone bottom navigation, tablet icon rail, desktop full sidebar;
- add/edit transaction dialog uses a wider two-pane desktop layout and a single-column mobile sheet;
- the heavy transaction/OCR code path is code-split and preloaded after idle; Tesseract itself is loaded dynamically only when OCR is requested;
- full-screen modal backdrop blur was removed to reduce GPU/compositor cost on phones;
- OCR can use normalized image regions for amount, timestamp, merchant/recipient, balance, description, generic text or ignored areas;
- region templates live inside encrypted `settings`, so a layout created on one device can follow the user through Drive sync;
- preferences such as language, theme, defaults and preferred remember durations are stored in encrypted synced settings. Actual OAuth tokens and remembered DEKs remain device-local by design;
- monthly category budgets, tags, advanced transaction filtering, edit/duplicate actions and local JSON/CSV export were added.

## v0.6.0 OCR workflow notes

For irregular bank layouts, O-Wallet now supports two complementary ways to teach the parser:

1. **Spatial regions** — draw a rectangle on the screenshot and assign it to Amount, Time, Recipient, Balance, Description, Generic context, or Ignore. Existing rectangles can be moved/resized/relabelled.
2. **Explain OCR results** — run OCR first, then assign a semantic meaning to each detected OCR line. O-Wallet converts that line's bounding box into a normalized region. This is useful for text such as `Nội dung: gửi xe` or bank-specific date renderings such as `29 thg 10, 2022 17:33`.

Field regions strip short inline labels by default, so a region containing `Nội dung: gửi xe` produces `gửi xe` rather than storing the label itself. This behavior can be disabled per region.

Selecting multiple images exposes **Batch OCR**. OCR is processed sequentially with one reusable Tesseract worker, producing one editable draft per image. Existing wallet transactions **and earlier drafts in the same batch** are checked for semantic duplicates using amount/account/time plus recipient/description similarity. Exact-looking matches are deselected by default. This is distinct from Drive synchronization conflicts: sync conflict resolution handles competing versions of the same UUID, while OCR duplicate detection looks for separate transaction UUIDs that appear to represent the same real-world transaction.


## v0.6.3 bulk OCR review layout fix

- Bulk OCR review now spans the full transaction modal width instead of being nested inside the already-narrow screenshot column.
- The transaction modal clips horizontal overflow and all major grid children use `min-width: 0`, preventing accidental page-width expansion.
- Bulk image list, preview, form fields, long file names, and the “include this image” checkbox now wrap responsively without collapsing into vertical text.
- The modal maximum width is increased to `max-w-7xl` on desktop while remaining full-width on small screens.

## v0.6.2 Google session / startup notes

- Startup no longer waits for Google Identity Services before showing the local vault. Local IndexedDB state is hydrated first; Drive reconnection runs in the background.
- A short 140 ms delayed splash suppresses the one-frame loading flash on fast devices, while longer boots still show a stable O-Wallet loader.
- Remembered Google sessions use three silent renewal attempts (`0 ms`, `1.2 s`, `4 s`) after an expired token is detected. Focus/online events trigger later retries with a cooldown.
- While the app remains open, O-Wallet attempts silent renewal roughly 90 seconds before token expiry.
- If silent renewal cannot proceed, the UI shows **Reconnect required** and a user-initiated reconnect button. Local encrypted data remains available.
- Legacy builds that stored an access token in long-lived local storage are migrated: a still-valid token is moved to `sessionStorage`, while `localStorage` retains only reconnect metadata.
- The project-portfolio footer is branded **O-Lab** and links to `https://oppai1442.github.io/all/`.


## 7. Create a browser API key for Shared Wallets

Create a Google Cloud API key for the same project. This key is visible in the browser and **must not be treated as a secret**.

Recommended restrictions:

```text
Application restriction: Websites (HTTP referrers)
https://<username>.github.io/*
http://localhost:5173/*

API restrictions:
Google Drive API
Google Picker API
```

Store it in the GitHub Actions repository variable `VITE_GOOGLE_API_KEY`. The deploy workflow injects it at build time together with `VITE_GOOGLE_CLIENT_ID`.

If a deployment does not configure this key, personal wallets continue to work but Shared Wallets are disabled.
