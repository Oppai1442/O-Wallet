# O-Wallet security model

## Goals

1. O-Wallet's developer does not run a central transaction/image backend.
2. Each user owns the Google Drive files created by O-Wallet.
3. Transaction content and image content are encrypted before Drive upload.
4. The encryption password and unwrapped DEK are never intentionally uploaded.
5. Google OAuth access tokens are never sent to an O-Wallet backend. Active bearer tokens are persisted only in `sessionStorage` to survive reloads in the current tab; longer remember windows persist account/reconnect metadata only.

## Key hierarchy

O-Wallet generates a random 256-bit Data Encryption Key (DEK). The DEK encrypts wallet records and image containers with AES-256-GCM.

The password does not directly encrypt each record. Instead:

```text
password -> PBKDF2-SHA256 (600,000 iterations + random salt) -> KEK
KEK -> AES-GCM wraps DEK
```

Recovery uses a separate randomly generated recovery key:

```text
192-bit random recovery key -> domain-separated SHA-256 -> recovery KEK
recovery KEK -> AES-GCM wraps the same DEK
```

That separation means a future password-change flow can re-wrap the DEK without re-encrypting all records/images.

## Security questions

Security questions have low entropy and are **not** treated as encryption keys. Their normalized answers are salted and hashed, and the recovery UI requires them before attempting recovery-key unwrap. The random recovery key remains the cryptographic recovery secret.

This is deliberately stricter than treating a memorable answer like "first pet" as key material.

## Local database

IndexedDB contains:

- encrypted record payloads;
- encrypted image payloads;
- non-secret sync metadata (UUID, version, updated time, device ID, tombstone flag, record kind);
- vault key-wrapping metadata (salt, KDF parameters, wrapped DEK, recovery answer hashes).

The local database does not intentionally store plaintext transaction JSON or plaintext image bytes after a save completes. Synced preferences, OCR region templates and budget configuration live inside the encrypted `settings` record rather than plaintext browser configuration. If the user explicitly enables remembered vault unlock, IndexedDB also stores a non-extractable DEK `CryptoKey` and an expiry timestamp on that device. The default is disabled.

## Cloud storage

The user's visible `O-Wallet/` Drive folder contains:

```text
O-Wallet/
├── vault.json          # key-wrapping metadata; no plaintext transaction data
├── records/
│   └── <uuid>.owr      # AES-GCM binary ciphertext
└── images/
    └── <uuid>.owi      # AES-GCM binary ciphertext
```

Image plaintext is packed as metadata + raw bytes, then encrypted. It is not converted to base64 before encryption or upload.

Drive still sees unavoidable synchronization metadata such as file sizes, modification times, opaque UUIDs and appProperties used for merge/versioning.

## Threats this design helps against

- accidental public exposure of Drive files;
- compromise of an O-Wallet static hosting origin **after** previously uploaded ciphertext has already been stored (historical Drive blobs remain encrypted);
- developer database breach, because there is no central O-Wallet database in this architecture;
- casual inspection/copying of IndexedDB while the vault is locked **and remembered unlock is disabled**.

## Threats this design does not solve

- malicious JavaScript served by a compromised GitHub Pages deployment while a user unlocks the vault (the page can observe plaintext/key material at runtime);
- malware/browser extensions with access to the page or device;
- weak user passwords being offline-guessed against `vault.json`;
- a user losing both password and recovery key;
- Google/account metadata leakage such as access times and ciphertext sizes;
- screenshots copied elsewhere by Android/iOS before O-Wallet receives them.

For a public release, protect the GitHub account/repository with strong MFA, branch protection, dependency review, and reproducible deployments.

## Password guidance

The UI only enforces 8 characters for V1 usability. A public release should add a strength estimator and encourage long passphrases. Because `vault.json` contains a password-wrapped DEK, an attacker who steals that file can attempt password guesses offline.

## Session persistence trade-offs

Google authorization and vault unlocking are separate:

- Google connection defaults to the current tab session. The access token is kept in `sessionStorage`, so F5/reload does not immediately disconnect the app. Long remember windows store only account/reconnect metadata in `localStorage`. O-Wallet performs pre-expiry silent renewal, a short retry burst after expiry/reload, and later focus/online retries. Google can still require explicit user interaction because the app has no backend refresh-token service.
- Vault remembered unlock is disabled by default. If the user enables it, O-Wallet stores the non-extractable DEK `CryptoKey` in IndexedDB until the selected expiry. This improves convenience but reduces protection against someone who can use the same browser profile. The preferred remember duration may be synced as an encrypted setting, but the actual DEK never follows that preference into Drive.
- Explicit **Lock vault** clears the remembered DEK immediately.
- **Switch Google account on this device** clears local ciphertext, vault config, account binding and remembered DEK, but does not delete Drive data.

Do not enable remembered unlock on shared/untrusted devices.


## OCR teaching and batch import

OCR teaching, region editing, inline-label cleanup, date parsing and semantic duplicate detection all execute in the browser. Raw screenshots are not sent to an O-Wallet backend. During multi-image OCR, each accepted source image is encrypted locally before it is written to IndexedDB/Drive.

Semantic duplicate warnings are advisory. Exact-looking matches are deselected by default in the batch review UI, but the user can explicitly choose to save them. This mechanism is not a cryptographic or synchronization conflict check and does not delete existing records.


## Google token migration in v0.6.2

Older O-Wallet builds could keep the current bearer token inside the long-duration local session object. v0.6.2 migrates that format: a still-valid token is moved to `sessionStorage`, and the long-lived `localStorage` record is rewritten without `accessToken` / `expiresAt`. Expired tokens are discarded. This reduces the lifetime of bearer credentials in persistent browser storage, but XSS on an active O-Wallet origin can still access the current session token and remains a threat.

## Importing third-party backup files

The external-data importer is local-only by design:

- the user-selected backup is read with the browser File API;
- its `ArrayBuffer` is transferred to a dedicated Web Worker;
- SQLite parsing runs with `sql.js` / WebAssembly inside that worker;
- the original backup bytes are not written to O-Wallet IndexedDB and are not uploaded to Google Drive or an O-Wallet backend;
- only the normalized entities the user confirms are passed to the normal O-Wallet repository, encrypted, and synchronized.

Backup files are untrusted input. Adapters use fixed SQL statements rather than source-controlled SQL strings, validate required tables before parsing, reject malformed rows, and close the in-memory database when parsing ends. Parsing in a worker also isolates expensive SQLite work from the main UI thread, although it is not a security sandbox against browser/runtime vulnerabilities in the SQLite/WASM dependency. Keep `sql.js` updated as part of dependency maintenance.

Source-specific semantics that are not reliable enough to infer are surfaced for explicit user choice instead of being silently converted. Attachment metadata does not imply that the original image bytes are present; O-Wallet does not attempt to follow filesystem paths embedded in a backup.


## v0.8.0 metadata additions

Account group names, category hierarchy metadata and OCR automation rules are encrypted inside normal O-Wallet records/settings before Drive sync. Rule text can contain recipient names or spending patterns, so it is intentionally not kept as plaintext application metadata.


## Sync metadata in v0.9.0

Incremental synchronization stores non-secret operational metadata in IndexedDB: Drive file IDs, entity IDs, version/timestamp/device stamps, a Drive Changes API cursor and pending sync IDs. Encrypted transaction/image payloads remain unchanged. Remote image bytes are downloaded only when viewed on a secondary device. OAuth access tokens are still handled by the existing Google session layer and are not added to the sync metadata tables.


## v0.10.0 browser and supply-chain hardening

O-Wallet has no application backend, but the browser is a privileged execution environment while a vault is unlocked. v0.10.0 therefore treats frontend integrity as a primary security boundary.

### Browser policy

Production builds inject a restrictive CSP that allows only the resource origins needed by the bundled app, Google Identity/Drive, and Tesseract runtime assets. The production page uses `no-referrer`; Google/Drive requests use `cache: no-store` and `referrerPolicy: no-referrer`. O-Wallet also refuses to render when embedded in a parent frame. Compatible hosts can additionally serve the headers in `public/_headers`, including `frame-ancestors 'none'`, `nosniff`, COOP and Permissions-Policy. GitHub Pages does not consume `_headers`, so its deployment relies on meta CSP plus the runtime frame guard.

### Ciphertext binding

New record/image payloads use AES-GCM format v2 with authenticated additional data (AAD). The AAD identifies the expected entity (`record:<kind>:<id>` or `image:<id>`). An encrypted blob copied to another record, kind or image ID will fail authentication. Version-1 ciphertext remains decryptable for migration compatibility and is upgraded naturally when the entity is next written.

### Hostile input/resource limits

User-selected images and SQLite backups are treated as untrusted input. O-Wallet validates file signatures and bounded sizes before processing, limits image decoded pixels, caps OCR text/box output, limits SQLite source rows/strings and enforces a worker timeout. Remote Drive payloads are also size-bounded before they enter decrypt/parse paths. These controls primarily reduce denial-of-service and parser-risk exposure; they do not turn browser/WASM parsers into formal sandboxes.

### Password/recovery validation

New password wrapping uses PBKDF2-HMAC-SHA256 with 600,000 iterations. Vault parameters are validated before KDF/decrypt work so a modified `vault.json` cannot request arbitrarily expensive iteration counts. Security-question answers have independent salted PBKDF2 verifiers, but the questions are not cryptographic recovery secrets: recovery still requires the random recovery key.

### Frontend/supply chain

CI rejects common high-risk source primitives (`dangerouslySetInnerHTML`, direct `innerHTML`, `eval`, `new Function`, `document.write`), broad Drive OAuth scope, accidental secrets and unprotected `_blank` links. Runtime dependencies are exact-version pinned in `package.json`; production source maps are forbidden; lifecycle scripts are disabled during CI install; high-severity `npm audit`, CodeQL, Dependabot and post-build secret/CSP checks are configured.

For fully reproducible dependency resolution, maintainers should also generate, review and commit `package-lock.json` from a trusted machine.

### What these measures do not solve

Encryption at rest cannot protect plaintext while a legitimate O-Wallet tab is unlocked if the browser/device or the deployed frontend itself is compromised. A malicious browser extension, device malware, compromised GitHub maintainer/deployment, or malicious dependency that reaches the final bundle can act with the same privileges as O-Wallet. Protect maintainer Google/GitHub accounts with passkeys/2FA, protect the main branch and review dependency/workflow changes. Independent review is recommended before describing O-Wallet as high-assurance financial software.



## v0.13.0 speech-recognition boundary

Voice entry does not add an O-Wallet speech backend. O-Wallet invokes the browser's Speech Recognition API, keeps only recognized text and user-approved accent correction pairs, and never stores microphone audio in IndexedDB or Google Drive. Depending on the browser/platform, recognition may be performed locally or by the browser vendor's speech service; users should treat that provider as an external processing boundary.

The calibration profile is not an acoustic model. It is a bounded set of transcript substitutions plus field-specific vocabulary hints. This keeps synced data small and avoids retaining biometric-style voice recordings. Contextual phrase biasing is feature-detected and ignored when unsupported.

On hosts that honor `public/_headers`, microphone permission is restricted to the O-Wallet origin (`microphone=(self)`). GitHub Pages does not consume that file, so browser permission prompts and the existing frame/CSP protections remain the effective boundary there.

## v0.11.0 optional AI provider boundary

AI changes the privacy boundary only when the user explicitly invokes it. Normal OCR remains on-device. When **Read with AI** is used, the selected image is converted to a data URL in memory and sent directly from the browser to OpenRouter's Chat Completions endpoint; OpenRouter may route the request to the selected model provider. The request asks OpenRouter to deny provider data collection where supported.

The API key is a device-local secret. O-Wallet encrypts it with the current vault DEK and stores only ciphertext in IndexedDB. It is not part of `AppSettings`, Drive records, export files, or sync queues. Switching/restoring a vault clears device-local secret rows so a key encrypted under an old DEK is not retained. Endpoint/model configuration may sync because it is not secret.

AI output is untrusted input: response size is capped, only a small JSON schema is accepted, strings/numbers/dates are normalized, and unsupported fields are ignored. API/network errors are mapped to user-safe messages rather than exposing response bodies. The production CSP adds only `https://openrouter.ai` to `connect-src`; arbitrary custom endpoints are deliberately rejected in the reference build.

A third-party AI provider can see images the user chooses to send. Client-side Drive encryption does not protect an image while it is being intentionally submitted to that provider. Users should not enable/use AI for screenshots they do not want processed by the selected external service.


## Shared-wallet security model

v0.12.0 adds a distributed shared-wallet model while keeping the O-Wallet backend-free architecture.

- No participant receives write access to another participant's member feed or personal shared-wallet folder.
- Shared transactions include an immutable creator member ID, and normal editing/deletion is restricted to that member's own feed.
- The owner controls membership and group-key rotation through the encrypted control file. Before an active member is removed, O-Wallet copies that member's current feed into an owner-owned encrypted archive so the former member cannot rewrite historical group records through their own Drive file. Removal then rotates the group key. It prevents access to future control/feed rewrites encrypted under the new key, but it cannot erase plaintext or old ciphertext/keys a former member legitimately obtained while authorized.
- Per-user nicknames are private aliases in personal encrypted settings and never enter the group control/feed files.
- Invitation URLs contain a high-entropy **transport secret**, but they do not contain the group key ring. The initial group key ring is encrypted inside a tiny owner-created registration file that is shared only to the invited Google account. A forwarded invite link alone is therefore insufficient to recover shared-wallet keys.
- The registration-file Drive permission uses the invitation expiry time. The join flow also checks the signed-in Google email and explicitly selects/authorizes that exact file through Google Picker so `drive.file` can remain the only Drive OAuth scope.
- Pending invitees do not receive key-ring envelopes through the public control file. Once their registration is completed and the owner observes the join, they become active and can receive future rotations.
- Cross-account shared control/feed reads use public-by-link Drive files containing ciphertext only. File IDs and ciphertext are therefore not treated as authentication secrets; confidentiality depends on the group keys.
- Owner-only transport secrets used to wrap future group-key rings are stored only in the owner's personal encrypted AppSettings.
- Every member saves an encrypted personal safety snapshot of the current merged ledger. Snapshots are recovery aids, not consensus or immutable audit logs.
