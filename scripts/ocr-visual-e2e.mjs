import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'
import fs from 'node:fs/promises'

const host = '127.0.0.1'
const port = 4173
const url = `http://${host}:${port}/`
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', host, '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
})
preview.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
preview.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))

async function waitForServer() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Vite preview did not start within 45s')
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => console.error('[browser:error]', error))

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.__OWALLET_OCR_E2E__), undefined, { timeout: 15_000 })

  const deadline = Date.now() + 3 * 60_000
  let lastPhase = ''
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.__OWALLET_OCR_E2E__)
    if (!state) throw new Error('OCR visual harness disappeared after initialization')
    const phase = `${state.phase ?? ''}|${Math.round((state.progress ?? 0) * 100)}`
    if (phase !== lastPhase) {
      lastPhase = phase
      console.log(`[ocr-e2e] ${state.status} phase=${state.phase ?? 'unknown'} progress=${Math.round((state.progress ?? 0) * 100)}%`)
    }
    if (state.status !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }

  const result = await page.evaluate(() => window.__OWALLET_OCR_E2E__)
  if (result?.status === 'running') {
    throw new Error(`OCR visual harness exceeded 3 minutes at phase=${result.phase ?? 'unknown'} progress=${Math.round((result.progress ?? 0) * 100)}%`)
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result || result.status !== 'pass') {
    await page.screenshot({ path: 'ocr-visual-e2e-failure.png', fullPage: true })
    await fs.writeFile('ocr-visual-e2e-result.json', JSON.stringify(result ?? { status: 'missing' }, null, 2))
    process.exitCode = 1
  }
} catch (error) {
  console.error(error)
  try {
    const state = browser ? await browser.contexts()[0]?.pages()[0]?.evaluate(() => window.__OWALLET_OCR_E2E__).catch(() => undefined) : undefined
    const page = browser?.contexts()[0]?.pages()[0]
    if (page) await page.screenshot({ path: 'ocr-visual-e2e-failure.png', fullPage: true }).catch(() => undefined)
    await fs.writeFile('ocr-visual-e2e-result.json', JSON.stringify({ status: 'runner-fail', error: String(error), state }, null, 2))
  } catch {}
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
  if (preview.exitCode === null && preview.signalCode === null) {
    preview.kill('SIGKILL')
    await Promise.race([
      once(preview, 'exit').then(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
  }
  preview.stdout?.destroy()
  preview.stderr?.destroy()
}
