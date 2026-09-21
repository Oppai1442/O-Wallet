import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import fs from 'node:fs/promises'

const host = '127.0.0.1'
const port = 4173
const url = `http://${host}:${port}/`
const preview = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'preview', '--', '--host', host, '--port', String(port)], {
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
  await page.waitForFunction(() => {
    const state = window.__OWALLET_OCR_E2E__
    return state && state.status !== 'running'
  }, undefined, { timeout: 8 * 60_000 })

  const result = await page.evaluate(() => window.__OWALLET_OCR_E2E__)
  console.log(JSON.stringify(result, null, 2))
  if (!result || result.status !== 'pass') {
    await page.screenshot({ path: 'ocr-visual-e2e-failure.png', fullPage: true })
    await fs.writeFile('ocr-visual-e2e-result.json', JSON.stringify(result ?? { status: 'missing' }, null, 2))
    process.exitCode = 1
  }
} catch (error) {
  console.error(error)
  try { await fs.writeFile('ocr-visual-e2e-result.json', JSON.stringify({ status: 'runner-fail', error: String(error) }, null, 2)) } catch {}
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  preview.kill('SIGTERM')
  setTimeout(() => preview.kill('SIGKILL'), 2000).unref()
}
