import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []
const warn = []

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(p) : [p]
  })
}

function rel(file) { return path.relative(root, file).replaceAll('\\', '/') }
function fail(message) { failures.push(message) }

const sourceFiles = walk(path.join(root, 'src')).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file))
const banned = [
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML'],
  [/\.innerHTML\s*=/, 'innerHTML assignment'],
  [/\.outerHTML\s*=/, 'outerHTML assignment'],
  [/\beval\s*\(/, 'eval'],
  [/new\s+Function\s*\(/, 'new Function'],
  [/document\.write\s*\(/, 'document.write'],
  [/client_secret/i, 'client_secret'],
  [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, 'private key'],
]

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8')
  for (const [pattern, label] of banned) if (pattern.test(text)) fail(`${rel(file)}: forbidden ${label}`)
  if (file.endsWith('security.ts')) continue
  if (/console\.(?:log|error|warn)\s*\(/.test(text)) fail(`${rel(file)}: console output must go through reportDiagnostic`)
}

const allText = sourceFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
if (/https:\/\/www\.googleapis\.com\/auth\/drive(?:['"\s`]|$)/.test(allText)) fail('Full Google Drive scope detected; use drive.file only')
if (!allText.includes('https://www.googleapis.com/auth/drive.file')) fail('drive.file OAuth scope is missing')
if (!allText.includes("payload.version === 2")) fail('AES-GCM v2/AAD compatibility guard is missing')
if (!allText.includes('O-Wallet payload v2:')) fail('Encrypted payload AAD binding is missing')

if (!allText.includes('maxOcrTextChars') || !allText.includes('maxOcrBoxes')) fail('OCR output limits are missing')
if (!allText.includes('maxSqliteImportBytes') || !allText.includes('maxImagePixels')) fail('Untrusted-file resource limits are missing')
if (!allText.includes('assertVaultConfigParameters')) fail('Vault parameter validation is missing')
if (!allText.includes("sessionStorage") || !allText.includes("DEVICE_SESSION_KEY")) fail('Google session storage policy markers are missing')

const sharedWalletSource = fs.readFileSync(path.join(root, 'src', 'lib', 'sharedWallet.ts'), 'utf8')
const inviteInterface = sharedWalletSource.match(/interface InvitePayload \{([\s\S]*?)\n\}/)?.[1] ?? ''
if (/\bkeyRing\b/.test(inviteInterface) || /\bgroupKey\b/.test(inviteInterface)) fail('Shared-wallet invitation URL payload must not contain group keys')
if (!sharedWalletSource.includes("member.status !== 'active'")) fail('Pending shared-wallet invitees must not receive public control key envelopes')
if (!sharedWalletSource.includes('registration.keyRing')) fail('Shared-wallet initial key ring is not protected inside the registration file')
if (!sharedWalletSource.includes('INVITE_TTL_MS')) fail('Shared-wallet invitation TTL is missing')
if (!sharedWalletSource.includes('Date.parse(invite.expiresAt) < Date.now()')) fail('Shared-wallet invitation URL expiry validation is missing')
if (!sharedWalletSource.includes('Date.parse(registration.expiresAt) < Date.now()')) fail('Shared-wallet registration expiry validation is missing')
if (!sharedWalletSource.includes('createdByMemberId')) fail('Shared-wallet creator attribution is missing')
if (!sharedWalletSource.includes('archiveMemberFeedBeforeRemoval')) fail('Shared-wallet member-removal archive is missing')

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
    if (/^[~^*]|\s|\|\||>|<|latest/i.test(String(version))) fail(`${section}.${name} is not exact-pinned: ${version}`)
  }
}

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
if (!index.includes('OWALLET_SECURITY_META')) fail('index.html CSP injection marker missing')
if (!index.includes('name="referrer" content="no-referrer"')) fail('no-referrer meta missing')
const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
for (const directive of ["object-src 'none'", "base-uri 'none'", "script-src 'self'", "script-src-attr 'none'", "worker-src 'self'", 'upgrade-insecure-requests', 'https://apis.google.com', 'https://drive.google.com']) {
  if (!vite.includes(directive)) fail(`production CSP missing: ${directive}`)
}
if (/runtimeCaching:\s*\[\s*\{/.test(vite)) fail('Third-party PWA runtime cache is enabled')
if (!/sourcemap:\s*false/.test(vite)) fail('Production source maps are not explicitly disabled')

const headers = path.join(root, 'public', '_headers')
if (!fs.existsSync(headers)) fail('public/_headers hardening template missing')
else {
  const text = fs.readFileSync(headers, 'utf8')
  for (const header of ['X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Cross-Origin-Opener-Policy: same-origin-allow-popups']) {
    if (!text.includes(header)) fail(`_headers missing ${header}`)
  }
}

for (const file of sourceFiles.filter((f) => f.endsWith('.tsx'))) {
  const text = fs.readFileSync(file, 'utf8')
  const matches = text.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/g)
  for (const match of matches) if (!/rel=["'][^"']*(?:noopener|noreferrer)/.test(match[0])) fail(`${rel(file)}: target=_blank without rel protection`)
}

if (failures.length) {
  console.error(`Security check failed (${failures.length}):`)
  for (const item of failures) console.error(` - ${item}`)
  process.exit(1)
}
for (const item of warn) console.warn(`WARN: ${item}`)
console.log(`Security source check PASS (${sourceFiles.length} source files)`)
