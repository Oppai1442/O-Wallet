import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const dist = path.join(root, 'dist')
if (!fs.existsSync(dist)) throw new Error('dist/ does not exist; build first')
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p); else files.push(p)
  }
}
walk(dist)

const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
if (!index.includes('Content-Security-Policy')) throw new Error('Built index is missing CSP')
if (index.includes('OWALLET_SECURITY_META')) throw new Error('Built index still contains the CSP marker')
if (!index.includes('no-referrer')) throw new Error('Built index is missing Referrer Policy')
if (files.some((f) => f.endsWith('.map'))) throw new Error('Production source maps must not be deployed')

const secretPatterns = [
  /ya29\.[A-Za-z0-9._~-]+/,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /client_secret\s*[:=]/i,
  /VITE_[A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY)\s*[:=]/i,
]
for (const file of files.filter((f) => /\.(?:js|html|json|txt)$/.test(f))) {
  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of secretPatterns) if (pattern.test(text)) throw new Error(`Potential secret in ${path.relative(root, file)}`)
}
console.log(`Security dist check PASS (${files.length} built files)`)
