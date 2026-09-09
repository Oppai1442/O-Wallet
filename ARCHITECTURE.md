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
  -> load local vault config + device preferences first
  -> restore active Google token from sessionStorage if still valid
  -> otherwise restore remembered Google account/reconnect metadata
  -> if remembered unlock is enabled and unexpired, restore the IndexedDB CryptoKey
  -> otherwise show password unlock
  -> render local UI without waiting for Google network renewal
  -> in background: silent Google renewal (3 attempts)
  -> on success: sync Drive; on failure: mark reconnect required
```

That last ordering is important on a new device: remote records are pulled before local defaults are created, preventing duplicate seed accounts/categories and ensuring desktop-created transactions appear on mobile immediately after unlock.

O-Wallet also binds a local vault to the Google account used for sync. A mismatched account is blocked, and a different remote vault is never overwritten automatically.


## Batch and recurring transaction materialization

O-Wallet does not require a server-side scheduler. Multiple-date and recurring input is materialized on the client into normal encrypted transaction records immediately. A batch identifier is stored as optional metadata so related generated records can be recognized later.

Future records sync like any other record but are **not effective** for balance, budget, dashboard, or analytics calculations until `occurredAt <= current device time`. The UI refreshes its current-time boundary periodically and when the tab regains focus.

Batch persistence uses `WalletRepository.putMany()` with encrypted chunks to avoid triggering a full repository refresh and Drive sync for every generated record.


### Google reconnect state machine (v0.6.2)

```text
disconnected
    | explicit Connect
    v
connected ---- token near expiry ----> silent renew
    |                                  | success
    | token expires                    +------> connected
    v
reconnecting -- 3 silent failures --> attention
    ^                                    |
    | focus / online retry               | user Reconnect
    +------------------------------------+
```

The local vault is independent from this state machine. Drive being temporarily unavailable does not block viewing/editing the encrypted local cache.

## External backup import pipeline (v0.7.0)

Third-party backups are treated as untrusted local input. They do not pass through Drive or an O-Wallet server before parsing.

```text
selected .mmbak / SQLite file
        |
        v
ArrayBuffer (browser memory)
        | transferred, not copied
        v
module Web Worker
        |
        +-- sql.js / SQLite WASM
        +-- adapter format detection
        +-- source-specific normalization
        v
ExternalImportBundle
        |
        +-- preview / ambiguous-row review
        +-- account + category mapping
        +-- semantic duplicate detection
        v
normal O-Wallet entities
        |
        +-- encrypt locally
        +-- bulk-write IndexedDB
        `-- normal encrypted Drive sync
```

The first adapter recognizes the Money Manager Android schema (`ASSETS`, `INOUTCOME`, `ZCATEGORY`). Money Manager stores transfers as two mirrored source rows; the adapter pairs the reverse account edges at the same timestamp/amount and materializes one O-Wallet transfer. Each imported transaction carries `importSource` metadata containing the adapter ID, stable source ID and original row IDs. This makes a later re-import deterministic and separate from heuristic duplicate detection.

Rows whose semantics cannot be determined safely are never guessed by the worker. For the currently observed Money Manager balance-reconciliation codes, the worker returns them as ambiguous rows and the Settings UI asks the user whether to skip, treat as income, or treat as expense.

Photo records in a Money Manager backup are interpreted only as references. If the SQLite file does not contain image bytes, O-Wallet cannot recreate those attachments.


## Account catalogues, hierarchical categories and OCR rules (v0.8.0)

Account catalogues and OCR automation rules are stored inside the encrypted `settings` entity so they sync with the rest of a user's vault without introducing new Drive record kinds. `Account.catalogueId` is optional.

Categories remain individual encrypted `category` records and now support `parentId` plus `nodeType: group | item`. Missing `nodeType` from older data is treated as `item` for backward compatibility. Only item nodes are selectable for transactions. Category paths are reconstructed client-side by walking parent IDs, with cycle protection.

OCR rules are evaluated only after local OCR parsing. The first enabled matching rule may assign a leaf category and/or active account. Matching is currently deterministic: normalized substring matching for recipient/description, exact numeric amount, and optional transaction type.


## Viewport shell and URL state (v0.8.1)

The application shell uses a viewport-height layout (`100dvh`). The sidebar and mobile navigation are outside the main scroll container; only the content column scrolls. This keeps navigation and sidebar actions available regardless of page length. The content column is a flex column with `main` set to grow, which pins the footer to the bottom on short pages while allowing it to follow long content naturally.

Top-level UI state is encoded in query parameters instead of being kept only in React state:

- `?page=home`
- `?page=transactions`
- `?page=analytics`
- `?page=settings`
- `&action=add` for the add-transaction dialog

The shell listens to `popstate`, so browser Back/Forward navigation restores the corresponding section without a full page reload.
