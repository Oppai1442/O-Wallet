# O-Wallet architecture

```text
                       ┌─────────────────────┐
                       │    GitHub Pages     │
                       │ static PWA assets   │
                       └──────────┬──────────┘
                                  │ load UI
                                  ▼
┌──────────────────────────── user device ─────────────────────────────┐
│ React UI                                                            │
│   │                                                                 │
│   ├── OCR worker (Tesseract.js)                                     │
│   ├── transaction parser                                             │
│   ├── analytics / charts                                             │
│   ├── WebCrypto AES-GCM                                              │
│   └── IndexedDB (ciphertext cache)                                   │
│                         │                                            │
└─────────────────────────┼────────────────────────────────────────────┘
                          │ OAuth access token
                          ▼
                  Google Drive API
                          │
                          ▼
                  user's own My Drive
                     O-Wallet/
                    ciphertext only
```

## No runtime O-Wallet backend

Node.js is only a development/build dependency for Vite/Tailwind. Once built, O-Wallet is static HTML/CSS/JS and can be hosted on GitHub Pages.

## Data model

Records are individually addressable rather than one giant mutable `data.json`:

```text
transaction UUID -> encrypted record file
account UUID     -> encrypted record file
category UUID    -> encrypted record file
settings         -> encrypted record file
image UUID       -> encrypted image file
```

This costs more Drive files but makes multi-device merge simple and prevents unrelated concurrent writes from overwriting an entire database blob.

## Sync stamp

Every local/cloud entity has:

```text
id
version
updatedAt
deviceId
deleted
```

Ordering is deterministic:

1. higher version wins;
2. if versions collide, later `updatedAt` wins;
3. if still tied, lexicographically larger `deviceId` wins.

Different UUIDs merge independently. Deletes are tombstones so a deleted record is not resurrected merely because another device still has an older copy.

## OCR

V1 OCR flow:

```text
File/Blob
  -> Tesseract.js Web Worker
  -> text + blocks
  -> generic Vietnamese transaction heuristics
  -> prefilled transaction form
  -> user confirms/edits
```

V2 should insert a spatial reconstruction and bank-pattern layer between OCR and parsing:

```text
OCR blocks
  -> line/token reconstruction
  -> bank/app layout profile
  -> logical fields
  -> transaction candidate
```

The generic parser in V1 is intentionally not presented as a replacement for bank-specific pattern work.

## Reload/session lifecycle

```text
F5 / reload
  -> restore Google token from sessionStorage if still valid
  -> load local vault config
  -> if remembered unlock is enabled and unexpired, restore the IndexedDB CryptoKey
  -> otherwise show password unlock
  -> once unlocked + Google-connected, sync Drive before creating local defaults
```

That last ordering is important on a new device: remote records are pulled before local defaults are created, preventing duplicate seed accounts/categories and ensuring desktop-created transactions appear on mobile immediately after unlock.

O-Wallet also binds a local vault to the Google account used for sync. A mismatched account is blocked, and a different remote vault is never overwritten automatically.
