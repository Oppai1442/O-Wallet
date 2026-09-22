import { detectTransactionBlocks, recognizeImageTiled } from './lib/ocr'

declare global {
  interface Window {
    __OWALLET_OCR_E2E__?: {
      status: 'running' | 'pass' | 'fail'
      scenarios?: Array<{
        name: string
        textLength: number
        boxes: number
        blocks: number
        amounts: number[]
        tileCount: number
        retryCount: number
      }>
      error?: string
    }
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('synthetic canvas encode failed')), 'image/png')
  })
}

async function syntheticCapture({
  cards,
  dark,
  jitter,
}: {
  cards: number
  dark: boolean
  jitter: number
}) {
  const width = 720
  const cardHeight = 330
  const top = 30
  const height = top * 2 + cards * cardHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('canvas 2d unavailable')

  ctx.fillStyle = dark ? '#111827' : '#f3f4f6'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'top'

  for (let index = 0; index < cards; index += 1) {
    const y = top + index * cardHeight
    const shift = ((index % 3) - 1) * jitter
    ctx.fillStyle = dark ? '#1f2937' : '#ffffff'
    ctx.fillRect(24 + shift, y + 8, width - 48, cardHeight - 20)

    ctx.fillStyle = dark ? '#f9fafb' : '#111827'
    ctx.font = '700 28px Arial, sans-serif'
    ctx.fillText('Date:', 52 + shift, y + 35)
    ctx.font = '27px Arial, sans-serif'
    ctx.fillText(`21/09/2026 10:${String(10 + index).padStart(2, '0')}`, 180 + shift, y + 35)

    ctx.font = '700 28px Arial, sans-serif'
    ctx.fillText('Amount:', 52 + shift, y + 100)
    ctx.font = '30px Arial, sans-serif'
    ctx.fillText(`${(index + 1) * 100000} VND`, 190 + shift, y + 98)

    ctx.font = '700 27px Arial, sans-serif'
    ctx.fillText('Recipient:', 52 + shift, y + 165)
    ctx.font = '26px Arial, sans-serif'
    ctx.fillText(`TEST USER ${index + 1}`, 205 + shift, y + 165)

    ctx.font = '700 26px Arial, sans-serif'
    ctx.fillText('Description:', 52 + shift, y + 230)
    ctx.font = '25px Arial, sans-serif'
    ctx.fillText(`PAYMENT ${index + 1}`, 235 + shift, y + 230)

    ctx.strokeStyle = dark ? '#6b7280' : '#d1d5db'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(42, y + cardHeight - 22)
    ctx.lineTo(width - 42, y + cardHeight - 22)
    ctx.stroke()
  }

  return { blob: await canvasBlob(canvas), width, height }
}

function expectedAmountHits(amounts: number[], cards: number) {
  const expected = new Set(Array.from({ length: cards }, (_, index) => (index + 1) * 100000))
  return amounts.filter((amount) => expected.has(Math.round(amount))).length
}

async function runScenario(name: string, cards: number, dark: boolean, jitter: number) {
  const source = await syntheticCapture({ cards, dark, jitter })
  const ocr = await recognizeImageTiled(source.blob, undefined, {
    tileHeight: 900,
    overlap: 120,
    retries: 1,
    watchdogMs: 120000,
  })
  const blocks = detectTransactionBlocks(ocr.result, ocr.width, ocr.height, undefined, ocr.visual)
  const amounts = blocks.flatMap((block) => block.candidate.amount !== undefined ? [block.candidate.amount] : [])
  const hits = expectedAmountHits(amounts, cards)

  if (ocr.diagnostics.tileCount < 2) throw new Error(`${name}: tiled path not exercised`)
  if (ocr.result.boxes.length < cards * 6) throw new Error(`${name}: too few OCR boxes (${ocr.result.boxes.length})`)
  if (blocks.length < 2) throw new Error(`${name}: too few transaction blocks (${blocks.length}/${cards})`)
  if (hits < 2) throw new Error(`${name}: too few expected amount hits (${hits}/${cards})`)

  return {
    name,
    textLength: ocr.result.text.length,
    boxes: ocr.result.boxes.length,
    blocks: blocks.length,
    amounts,
    tileCount: ocr.diagnostics.tileCount,
    retryCount: ocr.diagnostics.retryCount,
  }
}

export async function runOcrVisualE2E(root: HTMLElement) {
  window.__OWALLET_OCR_E2E__ = { status: 'running' }
  const main = document.createElement('main')
  main.style.fontFamily = 'system-ui'
  main.style.padding = '24px'
  const title = document.createElement('h1')
  title.textContent = 'O-Wallet OCR visual E2E'
  const statusNode = document.createElement('p')
  statusNode.id = 'status'
  statusNode.textContent = 'Running synthetic OCR…'
  main.append(title, statusNode)
  root.replaceChildren(main)
  try {
    const scenarios = []
    scenarios.push(await runScenario('tiled-light', 3, false, 12))
    window.__OWALLET_OCR_E2E__ = { status: 'pass', scenarios }
    const status = document.getElementById('status')
    if (status) status.textContent = 'PASS'
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
    window.__OWALLET_OCR_E2E__ = { status: 'fail', error: message }
    const status = document.getElementById('status')
    if (status) status.textContent = `FAIL: ${message}`
  }
}
