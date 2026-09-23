import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const manifestPath = process.env.OWALLET_OCR_CALIBRATION_MANIFEST
  ? path.resolve(process.env.OWALLET_OCR_CALIBRATION_MANIFEST)
  : path.join(root, 'tests', 'ocr-calibration', 'manifest.json')

async function fileExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

if (!await fileExists(manifestPath)) {
  console.log('[ocr-calibration] no manifest.json found; skipping real-fixture calibration')
  process.exit(0)
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
  console.log('[ocr-calibration] manifest contains no cases; skipping')
  process.exit(0)
}

const fixtureRoot = path.dirname(manifestPath)
function fixturePath(file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('calibration case requires a fixture file')
  const resolved = path.resolve(fixtureRoot, file)
  const relative = path.relative(fixtureRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('calibration fixture must stay inside the manifest directory')
  return resolved
}

function inferredMime(file, explicit) {
  if (explicit) return explicit
  const ext = path.extname(file).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

const host = '127.0.0.1'
const port = 4174
const url = `http://${host}:${port}/?calibration=1`
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', host, '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
})
preview.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
preview.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))

async function waitForServer() {
  const deadline = Date.now() + 45_000
  const baseUrl = `http://${host}:${port}/`
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Vite preview did not start within 45s')
}

let browser
const results = []
try {
  await waitForServer()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => console.error('[browser:error]', error))

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(() => typeof window.__OWALLET_OCR_CALIBRATE__ === 'function', undefined, { timeout: 15_000 })

  for (const testCase of manifest.cases) {
    if (!testCase || typeof testCase !== 'object') throw new Error('invalid calibration case')
    const name = typeof testCase.name === 'string' ? testCase.name.trim() : ''
    if (!name) throw new Error('calibration case requires a name')
    const source = fixturePath(testCase.file)
    const bytes = await fs.readFile(source)
    const { file: _file, timeoutMs, ...rest } = testCase
    const payload = {
      ...rest,
      name,
      mimeType: inferredMime(source, testCase.mimeType),
      base64: bytes.toString('base64'),
    }
    console.log(`[ocr-calibration] running ${name}`)
    const timeout = Number.isFinite(timeoutMs) ? Math.max(30_000, Math.min(10 * 60_000, Number(timeoutMs))) : 5 * 60_000
    const result = await Promise.race([
      page.evaluate(async (input) => {
        if (!window.__OWALLET_OCR_CALIBRATE__) throw new Error('calibration harness unavailable')
        return window.__OWALLET_OCR_CALIBRATE__(input)
      }, payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name}: calibration exceeded ${Math.round(timeout / 1000)}s`)), timeout)),
    ])
    results.push(result)
    console.log(`[ocr-calibration] pass ${name}: blocks=${result.blocks} boxes=${result.boxes} tiles=${result.tileCount}`)
  }

  const report = { status: 'pass', version: manifest.version ?? 1, cases: results }
  await fs.writeFile('ocr-calibration-e2e-result.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(error)
  const report = { status: 'fail', version: manifest.version ?? 1, cases: results, error: String(error) }
  await fs.writeFile('ocr-calibration-e2e-result.json', JSON.stringify(report, null, 2)).catch(() => undefined)
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) await page.screenshot({ path: 'ocr-calibration-e2e-failure.png', fullPage: true }).catch(() => undefined)
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  if (preview.exitCode === null && preview.signalCode === null) {
    preview.kill('SIGTERM')
    await Promise.race([
      once(preview, 'exit').then(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
  }
  if (preview.exitCode === null && preview.signalCode === null) preview.kill('SIGKILL')
  preview.stdout?.destroy()
  preview.stderr?.destroy()
}
