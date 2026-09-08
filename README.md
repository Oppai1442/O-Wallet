# O-Wallet

Private, local-first expense tracker built as a static PWA.

## Architecture

- **Frontend:** React + Vite + TypeScript + Tailwind CSS.
- **Runtime backend:** none. Production is static HTML/CSS/JS.
- **Local database:** IndexedDB via Dexie; transaction and image payloads are AES-256-GCM ciphertext.
- **Identity / cloud authorization:** Google Identity Services.
- **Cloud storage:** a visible `O-Wallet/` folder in each user's own Google Drive, accessed with `drive.file`.
- **Cross-device sync:** UUID + version + updatedAt + deviceId. Deletes are tombstones; deterministic merge resolves equal-version concurrent edits.
- **OCR:** Tesseract.js in a Web Worker. Screenshot `Blob` is recognized locally and is not sent to an O-Wallet server.
- **Images:** encrypted from raw binary bytes. No base64 conversion before encryption/upload.
- **PWA:** installable, offline shell, runtime cache for OCR assets.

## Current V1 scope

Implemented:

- encrypted vault setup / password unlock;
- recovery key + security-question UX gate;
- encrypted IndexedDB records and image payloads;
- Google Drive per-user folder creation and encrypted binary sync;
- transactions: expense, income, transfer;
- multiple accounts and user categories;
- OCR screenshot import with heuristic transaction prefill;
- image preservation and encrypted image viewer;
- dashboard and analytics with range selector, cashflow charts, pie chart;
- mobile bottom navigation + desktop sidebar;
- light/dark/system themes;
- configurable image retention;
- PWA manifest/service worker.

Still intentionally V1 / needs hardening before a public launch:

- bank-specific pattern editor and spatial OCR reconstruction;
- edit-transaction UI (create/delete are present);
- automated integration tests against Google Drive;
- password-change flow and recovery-key rotation;
- stronger sync compaction/indexing for very large histories;
- storage cleanup for remote tombstones / expired images;
- Google OAuth production verification/branding configuration;
- self-hosted OCR language/core assets if fully offline *first-run* OCR is required.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

Set `VITE_GOOGLE_CLIENT_ID` in `.env`.

### Google Cloud configuration

1. Create a Google Cloud project.
2. Enable **Google Drive API**.
3. Configure the OAuth consent screen.
4. Create an **OAuth 2.0 Client ID → Web application**.
5. Add your development origin, typically `http://localhost:5173`, to **Authorized JavaScript origins**.
6. Add the final GitHub Pages origin when you deploy.
7. Put the client ID in `.env` as `VITE_GOOGLE_CLIENT_ID`.

The app requests:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

`drive.file` is deliberate: O-Wallet should manage files/folders the user opened or that O-Wallet created, not arbitrary Drive content.

## GitHub Pages

The Vite config uses `base: './'`, so built assets are relative and work on GitHub project pages as well as custom domains without a repo-specific base variable.

Deploy the generated `dist/` folder however you prefer.

## Crypto model

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

Security questions are **not** treated as high-entropy cryptographic recovery secrets. They are an additional recovery UX check; the random recovery key remains the actual recovery secret.

## Privacy notes

O-Wallet itself has no central data backend in this architecture. Google Drive is still the user's cloud storage provider, but uploaded O-Wallet transaction/image payloads are encrypted client-side before upload.

Some non-secret sync metadata is visible to Drive, including opaque entity UUIDs, version counters, timestamps, device IDs, delete flags, and record kind. Financial content and image contents remain inside ciphertext.

Google OAuth access tokens are held only in page memory by this implementation; a page reload requires authorization again rather than persisting the token in localStorage.
