# O-Wallet security model

## Goals

1. O-Wallet's developer does not run a central transaction/image backend.
2. Each user owns the Google Drive files created by O-Wallet.
3. Transaction content and image content are encrypted before Drive upload.
4. The encryption password and unwrapped DEK are never intentionally uploaded.
5. Google OAuth access tokens are not persisted to localStorage/IndexedDB by this implementation.

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

The local database does not intentionally store plaintext transaction JSON or plaintext image bytes after a save completes.

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
- casual inspection/copying of IndexedDB while the vault is locked.

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
