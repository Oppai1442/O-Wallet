# O-Wallet security model

## Goals

1. O-Wallet's developer does not run a central transaction/image backend.
2. Each user owns the Google Drive files created by O-Wallet.
3. Transaction content and image content are encrypted before Drive upload.
4. The encryption password and unwrapped DEK are never intentionally uploaded.
5. Google OAuth access tokens are never sent to an O-Wallet backend. By default they are persisted only in `sessionStorage` to survive reloads in the current tab; longer local reconnect windows are optional.

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

- Google connection defaults to the current tab session. The access token is copied to `sessionStorage`, so F5/reload does not immediately disconnect the app. Google access tokens are short-lived. Longer reconnect windows keep local account/reconnect metadata and attempt silent renewal when possible, but a pure static frontend cannot guarantee long-lived refresh without user interaction.
- Vault remembered unlock is disabled by default. If the user enables it, O-Wallet stores the non-extractable DEK `CryptoKey` in IndexedDB until the selected expiry. This improves convenience but reduces protection against someone who can use the same browser profile. The preferred remember duration may be synced as an encrypted setting, but the actual DEK never follows that preference into Drive.
- Explicit **Lock vault** clears the remembered DEK immediately.
- **Switch Google account on this device** clears local ciphertext, vault config, account binding and remembered DEK, but does not delete Drive data.

Do not enable remembered unlock on shared/untrusted devices.


## OCR teaching and batch import

OCR teaching, region editing, inline-label cleanup, date parsing and semantic duplicate detection all execute in the browser. Raw screenshots are not sent to an O-Wallet backend. During multi-image OCR, each accepted source image is encrypted locally before it is written to IndexedDB/Drive.

Semantic duplicate warnings are advisory. Exact-looking matches are deselected by default in the batch review UI, but the user can explicitly choose to save them. This mechanism is not a cryptographic or synchronization conflict check and does not delete existing records.
