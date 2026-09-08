# O-Wallet

O-Wallet is a private, local-first expense tracker built as a static PWA.

**No O-Wallet runtime backend is required.** The production deployment is static HTML/CSS/JS. The browser performs OCR, encryption, analytics and sync; encrypted cloud data is stored in the user's own Google Drive.

Current release: **v0.6.2**

## Highlights

- React + Vite + TypeScript + Tailwind CSS.
- Installable PWA with mobile bottom navigation and desktop sidebar.
- Vietnamese and English UI. Vietnamese copy uses neutral, plain-language product wording for regular users.
- IndexedDB via Dexie; transaction and image payloads are AES-256-GCM ciphertext.
- Google Identity Services + Google Drive API with `drive.file`.
- Visible `O-Wallet/` folder in each user's own Google Drive.
- Cross-device sync with UUID + version + timestamp + device ID + tombstones.
- Google session survives reload within the current tab; longer remember windows persist only reconnect metadata, retry silent renewal automatically, and expose a manual reconnect action when Google requires interaction.
- Optional per-device remembered vault unlock (15 minutes to 30 days); default remains password-on-reload.
- Local account switching clears only browser-side O-Wallet data and never deletes the Drive folder.
- Tesseract.js OCR runs in the browser with Vietnamese + English recognition assets and can parse user-selected spatial regions.
- OCR regions are editable after creation: move, resize, change semantic field, and optionally strip inline labels such as `Nội dung:` / `Recipient:`.
- OCR teaching mode lists detected text lines and lets the user explain what each line represents; those semantic mappings become reusable spatial regions.
- OCR region templates can be named, encrypted in synced settings and reused across devices.
- Multi-image OCR creates one draft transaction per screenshot, provides a review/repair queue, and saves selected drafts in one pass.
- Semantic duplicate detection warns about likely duplicate OCR imports; exact matches are skipped by default until the user explicitly re-selects them.
- Screenshot bytes are encrypted directly; images are **not** converted to base64 before encryption.
- Dashboard and analytics with range filters, cash-flow charts, category pie charts and monthly budget progress.
- Advanced transaction search/filtering, tags, edit and duplicate actions.
- Batch transaction creation: pick many calendar dates in one pass with one shared time.
- Recurring batch generation by weekday through a chosen end date. Future generated transactions are stored and synced immediately, but balances, budgets and analytics ignore them until their occurrence time.
- Decrypted JSON/CSV export is available as an explicit local action.
- Privacy Policy and Terms of Service pages included for public OAuth deployments.
- Footer links to **O-Lab**, the project hub at `https://oppai1442.github.io/all/`.

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
- multiple accounts and custom categories;
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
- PWA manifest/service worker;
- GitHub Actions Pages deployment workflow;
- public `privacy.html` and `terms.html`;
- automatic Drive pull immediately after restoring/unlocking on a new device;
- protection against accidentally overwriting a different O-Wallet vault already present in the selected Drive.

Still intentionally early-stage / needs hardening before serious public use:

- bank-specific prebuilt semantic pattern packs beyond user-created templates;
- import/restore from decrypted JSON/CSV exports;
- automated integration tests against Google Drive;
- password-change and recovery-key rotation flows;
- sync compaction/indexing for very large histories;
- remote tombstone / expired-image cleanup;
- stronger hostile-client / XSS hardening;
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

Set:

```env
VITE_GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
```

The Vite variable is build-time configuration. A Google OAuth **Client ID is public information** in a browser app; do not put a Google OAuth `client_secret` in this project.

---

# Self-deploy to GitHub Pages

The repository includes:

```text
.github/workflows/deploy.yml
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

## 2. Create a Google Cloud project

Open Google Cloud Console and create/select a project for the deployment.

Enable:

```text
Google Drive API
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


## v0.6.2 Google session / startup notes

- Startup no longer waits for Google Identity Services before showing the local vault. Local IndexedDB state is hydrated first; Drive reconnection runs in the background.
- A short 140 ms delayed splash suppresses the one-frame loading flash on fast devices, while longer boots still show a stable O-Wallet loader.
- Remembered Google sessions use three silent renewal attempts (`0 ms`, `1.2 s`, `4 s`) after an expired token is detected. Focus/online events trigger later retries with a cooldown.
- While the app remains open, O-Wallet attempts silent renewal roughly 90 seconds before token expiry.
- If silent renewal cannot proceed, the UI shows **Reconnect required** and a user-initiated reconnect button. Local encrypted data remains available.
- Legacy builds that stored an access token in long-lived local storage are migrated: a still-valid token is moved to `sessionStorage`, while `localStorage` retains only reconnect metadata.
- The project-portfolio footer is branded **O-Lab** and links to `https://oppai1442.github.io/all/`.
