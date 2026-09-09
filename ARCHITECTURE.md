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


## Incremental Drive synchronization (v0.9.0)

Steady-state synchronization no longer performs a full remote/local scan. IndexedDB now keeps three synchronization structures in addition to encrypted wallet content:

```text
syncQueue       local entity IDs that changed
remoteRecords   entity ID -> Drive file ID + version stamp
remoteImages    image ID  -> Drive file ID + version stamp
sync-v2-state   Drive layout IDs + Changes API cursor
```

The first sync captures a Drive start-page token, performs a full reconciliation, then consumes changes since that token. This closes the race window where another device could edit Drive while the initial folder listing is running. Later syncs call `changes.list` from the saved cursor and process only changed O-Wallet files.

Local writes enqueue `record:<id>` or `image:<id>` in the same browser database. The queue survives reloads and failed network requests. Pushes run with bounded concurrency (currently 5); an item is removed only after the uploaded stamp still matches the current local row, so a mutation that occurs while an upload is in flight remains queued.

Images use lazy cross-device hydration. A remote image change updates `remoteImages` metadata without downloading ciphertext. `WalletRepository.getImageBlob()` asks the active Drive session to hydrate a missing encrypted image only when it is viewed, then caches those bytes in IndexedDB. Records remain eager because they are small and required for balances/search/analytics.

Drive layout IDs are cached because renames do not change file IDs. A 404 invalidates the cache and triggers layout rediscovery. An invalid/expired change cursor falls back to one full reconciliation.


## Security boundary hardening (v0.10.0)

The security model deliberately avoids an O-Wallet application backend, but this does not make the browser untrusted-data-free. While unlocked, the browser possesses the DEK and can display plaintext. v0.10.0 therefore adds controls around the client execution and input boundaries:

```text
static deployment
  -> production CSP / no-referrer / frame guard
  -> exact-pinned dependency graph + CI checks
  -> Google OAuth (drive.file only)
  -> bounded Drive downloads
  -> vault parameter validation
  -> AES-GCM v2 + entity AAD
  -> encrypted IndexedDB / Drive payloads

untrusted files
  -> magic-byte + size validation
  -> image pixel limits / OCR output limits
  -> SQLite Worker timeout + row/string limits
  -> normalized entities
  -> normal encrypted repository write
```

AES-GCM v2 binds each payload to its logical identity. The ciphertext envelope itself still contains only format version, IV and ciphertext; entity identity remains ordinary sync metadata but is authenticated as AAD during encryption/decryption. v1 payloads remain readable for compatibility.

The security policy has two deployment tiers:

1. **GitHub Pages:** meta CSP, referrer meta, runtime clickjacking guard.
2. **Header-capable static host:** the same controls plus `public/_headers` (`frame-ancestors`, `nosniff`, COOP, Permissions-Policy).

No frontend policy can protect an already-unlocked vault from a compromised browser/device or a malicious production bundle. Deployment integrity and maintainer-account security remain part of the trust boundary.


## Optional AI image extraction (v0.11.0)

AI is an opt-in client-side integration, not a new O-Wallet backend. The browser sends an image directly to the configured OpenRouter endpoint only after the user presses the AI action. The OpenRouter endpoint and model live in encrypted `AppSettings`, while the API key is encrypted locally under the vault DEK and stored as a device-only IndexedDB secret.

```text
image selected by user
  ├─ normal OCR -> Tesseract in browser only
  └─ AI action  -> browser -> OpenRouter -> model provider -> JSON suggestion
                                             ↓
                                  normalize/validate locally
                                             ↓
                                  local transaction rules
                                             ↓
                                      editable form
```

The reference CSP only permits `https://openrouter.ai` for AI network traffic. Arbitrary custom model hosts are intentionally not enabled because allowing unrestricted HTTPS destinations would weaken the CSP exfiltration boundary.



## Guided speech entry (v0.13.0)

Voice entry is a client-side, field-oriented workflow rather than a free-form command parser. The user chooses a recognition language and an ordered list of fields. Each step has a current/default value, so pressing Next without speaking simply keeps that value.

```text
microphone
   ↓
browser SpeechRecognition
   ↓
interim/final transcript
   ↓
accent correction profile
   ↓
field-specific parser / account-category matcher
   ↓
transaction draft
```

The accent profile is deliberately lightweight. Calibration stores recognized-text → expected-text corrections from a few short domain samples; it does not attempt to train or fine-tune an acoustic model in the browser. The same profile is encrypted inside `AppSettings.voiceInput` and therefore follows the user's normal Drive sync. No recorded audio is stored by O-Wallet.

Amount/date/time fields use deterministic parsers. Account/category fields use the user's existing vocabulary and full category paths. When the browser exposes contextual phrase biasing, those known phrases are supplied as hints; the feature remains optional because browser support is not uniform.

The reference deployment does not make a direct network request for speech recognition. Browser implementations may still process audio through their own speech service. Hosts that apply `public/_headers` now allow microphone access to the same origin with `Permissions-Policy: microphone=(self)`.

## Shared wallets (v0.12.0)

Shared wallets deliberately avoid a single folder with write permission granted to every participant.

```text
owner personal Drive                  member personal Drive
└─ shared-wallets/<group>/            └─ shared-wallets/<group>/
   ├─ control.owg (encrypted)            └─ feed.owf (encrypted)
   └─ invite-<member>.owr                    ↑ member writes only own feed

control.owg
├─ membership metadata
├─ per-member encrypted group-key envelopes
└─ references to member-owned feed file IDs
```

- A `SharedTransaction` records `createdByMemberId`; creator identity is stable even when a user changes their private nickname for that member.
- Nicknames live only in `AppSettings.sharedWalletAliases` in the current user's personal encrypted vault. They are not shared state.
- The owner stores invitation transport secrets only in `AppSettings.sharedWalletOwnerSecrets` in the owner's personal encrypted vault.
- Invitees are contacted by email through a Google Drive permission notification on a tiny encrypted registration file. The invitation URL contains only a random transport secret and identifiers; the initial group key ring is encrypted inside the registration file, which is shared only to the invited Google account and explicitly authorized through Google Picker under `drive.file`. The Drive permission expires with the invite.
- Pending invitees are deliberately omitted from the public control file's key envelopes. After the owner observes a successful join, that member becomes active and begins receiving future key-ring envelopes through the control file.
- Member feeds and the control file can be read as public-by-link ciphertext. Their contents remain AES-GCM encrypted with group keys; public readability is a transport/access mechanism, not plaintext sharing.
- Removing an active member first freezes their latest feed into an owner-owned encrypted archive, then rotates the current group key. The removed member can no longer rewrite their historical ledger through their own Drive file. New/re-written live feed data uses the new key. Existing plaintext or old keys legitimately obtained before removal cannot be revoked retroactively.
- Each participant stores a small encrypted merged-ledger snapshot in their own Drive for read-only recovery if live group control is unavailable.


## v0.13.1 state/UX notes

- Category selection is optional for personal transactions. Empty category IDs are treated as an uncategorized state, not as a hidden built-in category.
- Local entity saves update React state immediately, then reconcile from encrypted IndexedDB, so newly created accounts/categories are available without a reload.
- A valid GIS access token remains in `sessionStorage` across F5. O-Wallet no longer attempts background OAuth token acquisition after a new browser session because some browsers visibly flash the GIS popup; Drive reconnect is triggered by an explicit user action.
- Voice entry has a direct shell shortcut and URL action (`?action=voice`). Shared wallets remain a dedicated `?page=shared` route.
