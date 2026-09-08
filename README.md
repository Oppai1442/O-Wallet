# O-Wallet

O-Wallet is a private, local-first expense tracker built as a static PWA.

**No O-Wallet runtime backend is required.** The production deployment is static HTML/CSS/JS. The browser performs OCR, encryption, analytics and sync; encrypted cloud data is stored in the user's own Google Drive.

Current release: **v0.2.0**

## Highlights

- React + Vite + TypeScript + Tailwind CSS.
- Installable PWA with mobile bottom navigation and desktop sidebar.
- Vietnamese and English UI. Vietnamese copy uses neutral product language.
- IndexedDB via Dexie; transaction and image payloads are AES-256-GCM ciphertext.
- Google Identity Services + Google Drive API with `drive.file`.
- Visible `O-Wallet/` folder in each user's own Google Drive.
- Cross-device sync with UUID + version + timestamp + device ID + tombstones.
- Tesseract.js OCR runs in the browser with Vietnamese + English recognition assets.
- Screenshot bytes are encrypted directly; images are **not** converted to base64 before encryption.
- Dashboard and analytics with range filters, cash-flow charts and category pie charts.
- Privacy Policy and Terms of Service pages included for public OAuth deployments.

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
- local OCR screenshot import with heuristic transaction prefill;
- encrypted image preservation and viewer;
- dashboard and analytics;
- light / dark / system themes;
- Vietnamese / English language switch;
- configurable image retention;
- PWA manifest/service worker;
- GitHub Actions Pages deployment workflow;
- public `privacy.html` and `terms.html`.

Still intentionally early-stage / needs hardening before serious public use:

- bank-specific spatial OCR pattern editor;
- edit-transaction UI;
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

# Privacy summary

- The reference architecture has no central O-Wallet financial-data backend.
- Financial data and image payloads are encrypted client-side before Drive upload.
- Google OAuth access tokens are held in tab memory by the reference implementation.
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
