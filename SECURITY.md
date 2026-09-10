# O-Wallet security model

This document describes the security model of the current O-Wallet reference implementation, **v0.19.1**.

O-Wallet is browser software. Its primary confidentiality goal is to keep stored financial content encrypted at rest while avoiding an O-Project-owned transaction backend. It is **not** a substitute for endpoint security, browser integrity or an independent cryptographic audit.

---

## Security goals

1. O-Project does not operate a central transaction/image database for O-Wallet.
2. Each user owns the Google Drive files created by O-Wallet.
3. Transaction records and screenshot contents are encrypted before Drive upload.
4. The user password, recovery key and unwrapped DEK are not intentionally uploaded to Google Drive or an O-Project backend.
5. Google OAuth access tokens are not sent to an O-Wallet backend.
6. The default OAuth scope remains the narrow `drive.file` scope rather than unrestricted Drive access.
7. Device-only secrets such as OpenRouter API keys and Personal Cloud pairing tokens are encrypted locally with the current vault key and are not synced to Drive.

---

## Trust boundaries

O-Wallet has several distinct execution/data boundaries:

```text
O-Project / GitHub Pages
    -> serves static application code

User browser/device
    -> holds plaintext while unlocked
    -> performs encryption/decryption
    -> runs OCR/parsing/analytics/sync
    -> stores encrypted records/images in IndexedDB

Google
    -> identity provider
    -> Drive storage for encrypted O-Wallet files

Optional browser speech provider
    -> may process voice input depending on browser implementation

Optional OpenRouter/model provider
    -> processes only images explicitly submitted through AI reading

Optional Personal Cloud Worker
    -> deployed in the user's own Cloudflare account
    -> v1 handles pairing/capability/heartbeat metadata only
```

The **unlocked browser tab is a trusted runtime**. If that runtime is compromised, at-rest encryption cannot protect plaintext currently being used by the application.

---

## Key hierarchy

O-Wallet generates a random 256-bit Data Encryption Key (DEK). The DEK encrypts wallet records, images and device-local encrypted secrets using AES-256-GCM.

### Password wrapping

```text
password
  -> PBKDF2-HMAC-SHA256
     600,000 iterations + random salt
  -> password KEK
  -> AES-GCM wraps DEK
```

The UI currently enforces only a minimum password length of 8 characters. Longer passphrases are recommended because a stolen `vault.json` permits offline password guessing against the wrapped DEK.

### Recovery wrapping

```text
random 192-bit recovery key
  -> domain-separated SHA-256
  -> recovery KEK
  -> AES-GCM wraps the same DEK
```

The recovery key is the cryptographic recovery secret.

### Security questions

Security-question answers are **not encryption keys**. Their normalized answers are independently salted/verified and the recovery flow requires them before attempting recovery-key unwrap.

This does not make low-entropy questions equivalent to strong cryptographic secrets; they are only an additional verification layer.

---

## Ciphertext format and identity binding

New record/image payloads use AES-GCM format v2 with authenticated additional data (AAD).

AAD is tied to the expected entity identity:

```text
record:<kind>:<id>
image:<id>
local-secret:<name>
```

A valid ciphertext blob copied to a different record/image/local-secret identity therefore fails authentication.

Version-1 ciphertext remains readable for migration compatibility and is naturally upgraded when rewritten.

---

## Local database

IndexedDB contains:

- encrypted record payloads;
- encrypted image payloads;
- non-secret sync metadata such as UUID/version/timestamp/device ID/tombstone/kind;
- vault wrapping metadata;
- local Drive layout/cursor/sync-queue metadata;
- optional non-extractable `CryptoKey` objects used by remembered unlock or Quick Unlock compatibility mode;
- encrypted device-local secrets.

The repository encrypts local secrets using the active DEK and AAD `local-secret:<name>`. Current uses include the OpenRouter API key and Personal Cloud pairing token.

O-Wallet does not intentionally retain plaintext transaction JSON or plaintext screenshot bytes in IndexedDB after save completes.

Clearing site/browser data can remove the local database and device-only secrets. Google Drive data is unaffected unless separately deleted from Drive.

---

## Google Drive storage

The user's visible Drive folder contains:

```text
O-Wallet/
├── vault.json
├── records/
│   └── <uuid>.owr
└── images/
    └── <uuid>.owi
```

`vault.json` contains salts, KDF parameters, answer-verification metadata and wrapped DEKs. It does not contain plaintext transaction contents.

Image plaintext is packed as metadata + raw image bytes and then encrypted. Images are not converted to base64 before storage encryption/upload.

Google can still observe unavoidable metadata such as:

- file sizes;
- modification timestamps;
- opaque IDs;
- Drive permissions;
- appProperties used for synchronization;
- access/account metadata.

Client-side encryption does not hide those metadata classes.

---

## Google OAuth and session persistence

O-Wallet requests:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

The active bearer token is stored only in `sessionStorage` so F5/reload in the current tab can continue without immediately losing authorization.

Longer Google remember windows store only account/reconnect metadata in `localStorage`; they do **not** store the bearer token.

The current default Google remember duration is **30 days**. When valid remembered metadata exists, O-Wallet attempts silent reconnect on startup using Google Identity Services. Silent reconnect is best-effort: browser/Google policy may still require explicit user interaction.

O-Wallet also performs reconnect attempts around expiry/focus/online transitions where appropriate. It does not possess a backend refresh-token service.

### Account switching

`Switch Google account on this device` clears the local O-Wallet browser state for the current account, including vault config/device-bound unlock state/local secrets, but does not delete that user's Drive folder.

---

## Vault remembered unlock

Vault remembered unlock is a separate convenience feature from Google account remembering.

Current default:

```text
vaultRemember = off
```

If enabled, O-Wallet stores a non-extractable DEK `CryptoKey` in IndexedDB with an expiry timestamp.

This improves convenience but weakens protection against someone with access to the same browser profile/device. It is not intended for shared or untrusted devices.

Explicit `Lock vault` clears remembered DEK state.

---

## Quick Unlock / WebAuthn

Quick Unlock is a **per-device convenience layer** configured in Settings. It does not replace the password/recovery model.

The feature first verifies the current password, then creates a platform WebAuthn credential tied to the current origin/vault.

There are two modes.

### PRF mode

On platforms/authenticators that expose WebAuthn PRF:

```text
platform authenticator + user verification
    -> PRF output
    -> SHA-256 domain-separated derivation
    -> AES-GCM wrapping key
    -> unwrap local DEK copy
```

This binds the local Quick Unlock wrapping key to authenticator output.

### Platform-UV compatibility mode

Windows currently uses a compatibility path because Windows Hello/browser PRF behavior is inconsistent.

In this mode:

- Windows Hello/platform authenticator performs user verification;
- a separate non-extractable AES `CryptoKey` is stored locally in IndexedDB;
- the verified WebAuthn assertion acts as an application gate before that key is used to unwrap the DEK.

This mode is **not cryptographically equivalent to PRF mode**. A malicious script executing with O-Wallet's origin/browser privileges could potentially bypass application-level gating and use locally accessible key material. Treat it as protection against casual local access, not as a hardened hardware-bound vault.

Quick Unlock does not protect against:

- compromised frontend JavaScript;
- malicious browser extensions;
- device malware;
- an attacker controlling the same browser profile/runtime.

If Quick Unlock fails, the canonical password remains the fallback.

Quick Unlock configuration is device-local and not synced to Drive.

---

## OCR boundary

Normal OCR uses Tesseract.js in the browser.

O-Wallet does not intentionally send OCR screenshots to an O-Wallet backend. Teaching mode, region editing, inline-label cleanup, transaction parsing, rule matching and duplicate detection execute in the browser.

User-selected screenshots are validated and bounded before processing. Controls include limits for:

- file bytes;
- decoded image pixels;
- OCR text length;
- OCR box count.

Accepted images are encrypted locally before normal persistence/sync.

The service worker does not maintain a persistent third-party executable OCR runtime cache. Browser HTTP caches may still behave according to normal browser policy.

---

## Voice entry boundary

Voice Entry invokes the browser Speech Recognition API.

O-Wallet itself:

- does not store microphone audio;
- stores recognized text only as needed for the active workflow;
- may store user-approved accent correction pairs in encrypted settings;
- may provide field-specific vocabulary/context hints where supported.

Recognition processing location depends on the browser/device. Some browser implementations may send audio to the browser vendor's speech service. Therefore Voice Entry is **not guaranteed to be fully local**.

On hosts supporting `public/_headers`, microphone permission is restricted to the O-Wallet origin. GitHub Pages does not consume `_headers`, so browser permission prompts plus the application's CSP/frame protections remain the effective boundary there.

---

## Optional AI provider boundary

AI image reading is disabled by default.

When the user explicitly invokes AI reading:

- the selected image is held in memory and submitted directly from the browser to OpenRouter;
- OpenRouter may route it to the selected model provider;
- O-Wallet requests provider data collection denial where supported;
- the response is treated as untrusted input and passed through bounded parsing/normalization.

The OpenRouter API key is encrypted with the current DEK and stored as a **device-local secret**. It is not synced to Drive or included in ordinary export records.

The reference build allowlists only OpenRouter rather than arbitrary custom AI endpoints.

Client-side Drive encryption obviously cannot protect a screenshot while the user intentionally sends it to an external AI service.

---

## Third-party import boundary

Supported backup import is local-only by design.

The user-selected backup:

- is read through the browser File API;
- is transferred to a dedicated Web Worker;
- is parsed with `sql.js`/WASM;
- is not written as an original backup blob to O-Wallet IndexedDB;
- is not uploaded to Google Drive or an O-Wallet backend.

Only normalized entities the user confirms are passed into the regular encrypted O-Wallet repository.

Backup files are treated as untrusted input. The importer uses fixed queries/adapters, table/row validation, byte/row/string limits and worker timeouts.

A Web Worker isolates expensive parsing from the UI thread but is **not** a formal security sandbox against vulnerabilities in the browser/WASM/parser dependency.

---

## Shared Wallet security model

Shared Wallets keep the backend-free architecture while adding cross-account encrypted Drive sharing.

### Member feeds

Each member owns an encrypted member feed in their own Drive. Other participants do not receive write access to another participant's feed.

Shared transactions contain immutable creator attribution, and ordinary edit/delete operations are limited to the creator's own feed.

### Owner control and removal

The owner maintains encrypted membership/control data.

Before removing an active member, O-Wallet archives that member's current feed into owner-owned encrypted storage and then rotates the group key. Remaining members receive new key material through encrypted envelopes.

Key rotation does **not** erase plaintext, old ciphertext or keys a former member legitimately obtained while authorized.

### Invitations

Invite URLs contain a high-entropy **transport secret**, not the group key ring.

The initial group key ring is protected inside a registration file shared only to the invited Google account. The invitation Drive permission uses the invitation expiry time.

The join flow checks the signed-in Google identity and uses Google Picker to explicitly authorize/select the registration file, allowing O-Wallet to retain the narrow `drive.file` scope.

A forwarded invitation link alone is therefore insufficient to recover the initial group keys.

### Public ciphertext

Some shared control/feed files are readable by link as **ciphertext** to permit narrow cross-account reads without broader Drive OAuth access.

File IDs/public-read ciphertext are therefore not treated as authentication secrets. Confidentiality depends on the relevant group keys.

### Safety snapshots and nicknames

Each member keeps an encrypted personal safety snapshot of merged shared-wallet state. It is a recovery/read-only aid, not an immutable audit log or consensus layer.

Personal member nicknames live only in that user's encrypted personal settings and are not shared group state.

---

## Personal Cloud security model — experimental

Personal Cloud is optional. The companion Worker runs in the **user's own Cloudflare account**, not an O-Project Cloudflare account.

The current v1 Worker implements:

```text
GET /health
GET /v1/capabilities
KV-backed cron heartbeat
```

`/v1/capabilities` requires a bearer `PAIRING_TOKEN` configured as a Worker secret.

### Device-side storage

O-Wallet stores:

- Worker URL and capability/heartbeat metadata as local non-secret configuration;
- pairing token as a DEK-encrypted local secret.

The pairing token is not intentionally synced to Drive.

### Current Worker data boundary

Personal Cloud v1 does **not** send the following to the Worker:

- transaction records;
- balances;
- password;
- recovery key;
- DEK;
- security answers;
- bank screenshots;
- Google bearer token.

The Worker currently sees only request metadata, its bearer token, capability requests and heartbeat/KV state.

Future Automation Inbox/push/scheduled-action features must be reviewed against this boundary before being enabled.

### CORS and pairing

The reference Worker allowlists the O-Wallet GitHub Pages origin. Self-hosted deployments must update `ALLOWED_ORIGIN` accordingly.

The current pairing token is a bearer secret. Anyone who steals it and can reach the Worker can call authenticated Worker endpoints. It must therefore be random, unique and kept private.

### Hosted deploy importer

Deploy-to-Cloudflare is an external convenience service, not part of O-Wallet's cryptographic trust model. The repository currently treats that hosted importer as experimental because provider-side repository import/provisioning can fail independently of O-Wallet.

Manual Wrangler deployment remains the deterministic fallback.

---

## Browser security policy

The production application injects a restrictive Content Security Policy.

Current policy restricts executable/resource origins to those required for:

- bundled O-Wallet assets;
- Google Identity/Drive/Picker;
- Tesseract runtime/language resources;
- optional OpenRouter requests.

Additional controls include:

- `script-src-attr 'none'`;
- `object-src 'none'`;
- `base-uri 'none'`;
- `upgrade-insecure-requests`;
- `Referrer-Policy: no-referrer`;
- runtime refusal to render inside another frame;
- no production source maps.

GitHub Pages cannot apply arbitrary custom response headers from this repository. O-Wallet therefore uses meta CSP + runtime frame checks there.

`public/_headers` contains stronger headers for compatible hosts such as Cloudflare Pages, including `frame-ancestors`, `nosniff`, COOP and Permissions-Policy controls.

---

## Hostile-input and resource limits

O-Wallet treats browser-selected and remote data as untrusted input.

Current safeguards include validation/limits for:

- vault config structure and KDF parameters;
- remote Drive payload bytes;
- image file signatures;
- image byte size;
- decoded image pixels;
- OCR output length/box count;
- SQLite backup size;
- SQLite rows/strings;
- importer execution time;
- AI response shape/size;
- export filenames and spreadsheet formula prefixes.

These controls reduce parser and denial-of-service exposure but do not turn browser/WASM/third-party libraries into formally verified sandboxes.

---

## Supply-chain and CI controls

Source checks reject or flag high-risk conditions including:

- `dangerouslySetInnerHTML`;
- direct `innerHTML` / `outerHTML` writes;
- `eval`;
- `new Function`;
- `document.write`;
- broad unrestricted Google Drive OAuth scope;
- obvious client-secret/private-key material;
- unprotected `_blank` links;
- missing AAD/vault/resource-limit invariants.

Dependencies and devDependencies are exact-version pinned in `package.json`.

CI also performs:

- AES-GCM/AAD tamper smoke tests;
- vulnerability audit gate;
- TypeScript/Vite build;
- built-artifact secret/CSP/source-map checks;
- CodeQL workflow;
- Dependabot configuration.

The repository currently does **not** commit `package-lock.json` because of a previous Vite/Rolldown optional-dependency lock issue. CI resolves a lock for each run. This reduces reproducibility compared with a reviewed committed lockfile and should be revisited.

Automated checks are defensive invariants, not an independent security audit.

---

## Threats this design helps against

- Accidental exposure of encrypted Drive files.
- Casual inspection/copying of locked-vault IndexedDB when remembered-unlock/Quick-Unlock convenience paths are disabled.
- Central O-Project database breach for transaction content, because no such production transaction database exists in the reference architecture.
- Ciphertext substitution between different v2 records/images/local-secret identities.
- Some malformed/unbounded-input denial-of-service cases.

---

## Threats this design does not solve

- Malicious JavaScript served by a compromised O-Wallet deployment while a vault is unlocked.
- A malicious dependency included in the final application bundle.
- Browser extensions with page privileges.
- Device malware/keyloggers/screen capture.
- Compromise of the user's Google account/browser profile/device.
- Weak password offline guessing against stolen vault metadata.
- Loss of both password and recovery key.
- Metadata leakage through Drive/file/network activity.
- Screenshots copied/backed up elsewhere by the OS before O-Wallet receives them.
- External speech-provider processing when the browser uses cloud speech recognition.
- External AI-provider access to screenshots the user deliberately submits.
- Social/operational compromise of a Shared Wallet member.
- Personal Cloud bearer-token theft.

Encryption at rest cannot protect plaintext while the legitimate application runtime is actively using it.

---

## Operational recommendations

For the reference deployment and forks:

- use passkeys/strong MFA for GitHub and Google maintainer accounts;
- protect `main` with branch protection/rulesets where practical;
- require CI/security checks before merge;
- tightly restrict who can modify workflows/deployment configuration;
- review dependency upgrades;
- keep CodeQL/Dependabot/security alerts enabled;
- use long user passphrases;
- keep recovery codes offline/private;
- avoid remembered unlock on shared devices;
- restrict `VITE_GOOGLE_API_KEY` by HTTP referrer and required Google APIs;
- never add a Google OAuth `client_secret` to this browser project;
- use a unique high-entropy Personal Cloud pairing token;
- update `ALLOWED_ORIGIN` when self-hosting Personal Cloud.

---

## Manual testing still required

Current automated CI does not fully validate browser/provider-specific flows.

Manual smoke testing is still required for:

- new-account onboarding with an empty Drive;
- existing-vault restore/unlock;
- Google silent reconnect vs explicit reconnect;
- WebAuthn PRF on supported mobile platforms;
- Windows Hello platform-UV Quick Unlock;
- browser microphone permission and speech recognition;
- Google Picker/shared-wallet cross-account invitations;
- PWA install/update/offline shell behavior;
- Personal Cloud Worker provisioning/pairing on Cloudflare.

---

## Security status

O-Wallet has received iterative defensive hardening in the source and CI pipeline, but **no independent cryptographic or application-security audit has been completed**.

Do not describe the project as audited, formally verified, zero-knowledge, tamper-proof or high-assurance financial software.
