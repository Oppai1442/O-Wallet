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

Current OCR flow:

```text
File/Blob
  -> dynamically loaded Tesseract.js Web Worker
  -> text + word bounding boxes
  -> reconstructed OCR lines
       ├─ generic heuristic parser
       ├─ user "Explain OCR" semantic mapping
       └─ normalized editable regions
            amount / time / merchant / balance / description / generic / ignore
  -> inline-label cleanup / field parser
  -> prefilled transaction form
  -> user confirms/edits
```

Region rectangles are stored as normalized 0..1 coordinates, so a template is not tied to one exact screenshot resolution. Regions can be moved, resized, relabelled and configured to strip short inline labels such as `Nội dung:`. The teaching UI can turn any reconstructed OCR line into a semantic region, which lets a user explain bank-specific layouts without writing regex or code. Named OCR templates are stored inside the encrypted `settings` record and therefore follow the user through Drive sync.

The date parser includes common numeric formats plus bank UI forms such as `29 thg 10, 2022 17:33`. The parser remains heuristic; future prebuilt bank-specific semantic profiles can build on top of the same spatial/teaching layer.

### Multi-image OCR

```text
N screenshots
  -> reuse one Tesseract worker
  -> OCR sequentially (bounded memory)
  -> one transaction draft per image
  -> semantic duplicate check against local transactions + earlier drafts in the same OCR batch
  -> review queue (edit / include / skip)
  -> encrypt one source image per accepted transaction
  -> bulk-save accepted transaction records
```

Semantic duplicate detection is separate from synchronization conflict resolution. Sync conflicts compare versions of the same UUID. OCR duplicate detection compares different transaction UUIDs that have matching amount/account/time and similar recipient/description text.

The OCR dependency is code-split: the transaction modal is lazy-loaded and Tesseract itself is imported only when OCR is actually requested. This keeps normal navigation lighter.

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


## Batch and recurring transaction materialization

O-Wallet does not require a server-side scheduler. Multiple-date and recurring input is materialized on the client into normal encrypted transaction records immediately. A batch identifier is stored as optional metadata so related generated records can be recognized later.

Future records sync like any other record but are **not effective** for balance, budget, dashboard, or analytics calculations until `occurredAt <= current device time`. The UI refreshes its current-time boundary periodically and when the tab regains focus.

Batch persistence uses `WalletRepository.putMany()` with encrypted chunks to avoid triggering a full repository refresh and Drive sync for every generated record.
