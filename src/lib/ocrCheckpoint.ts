import type { OcrBox, OcrTileResumeState } from '../types'
import { SECURITY_LIMITS } from './security'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function saneBox(value: unknown, width: number, height: number): value is OcrBox {
  if (!value || typeof value !== 'object') return false
  const box = value as OcrBox
  if (typeof box.text !== 'string' || !finite(box.confidence) || !box.bbox) return false
  const { x0, y0, x1, y1 } = box.bbox
  if (![x0, y0, x1, y1].every(finite)) return false
  if (x1 < x0 || y1 < y0) return false
  const marginX = Math.max(64, width * 0.1)
  const marginY = Math.max(64, height * 0.1)
  return x0 >= -marginX && x1 <= width + marginX && y0 >= -marginY && y1 <= height + marginY
}

export function sanitizeOcrTileResumeState(value: unknown): OcrTileResumeState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const state = value as Partial<OcrTileResumeState>
  if (
    !finite(state.width) || !finite(state.height) || !finite(state.tileHeight) || !finite(state.overlap)
    || !finite(state.nextTileIndex) || !finite(state.visualLuma) || !finite(state.visualCount)
    || !finite(state.retryCount) || typeof state.startedAt !== 'string'
  ) return undefined
  if (
    state.width <= 0 || state.height <= 0 || state.tileHeight < 900 || state.tileHeight > 4200
    || state.overlap < 0 || state.overlap >= state.tileHeight
    || state.nextTileIndex < 0 || state.nextTileIndex > 10000
    || state.retryCount < 0 || state.retryCount > 10000
  ) return undefined
  if (
    !Array.isArray(state.boxes) || !Array.isArray(state.texts) || !Array.isArray(state.visualColors)
    || !Array.isArray(state.visualProfileSum) || !Array.isArray(state.visualProfileCount)
    || !Array.isArray(state.tileDurationsMs)
  ) return undefined
  if (state.boxes.length > SECURITY_LIMITS.maxOcrBoxes || state.texts.length > 10000) return undefined
  if (state.visualProfileSum.length !== state.visualProfileCount.length || state.visualProfileSum.length > 4096) return undefined
  if (state.tileDurationsMs.length > 10000) return undefined
  if (!state.boxes.every((box) => saneBox(box, state.width!, state.height!))) return undefined
  if (!state.texts.every((text) => typeof text === 'string' && text.length <= 4000)) return undefined
  if (!state.visualColors.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && finite(entry[1]) && entry[1] >= 0)) return undefined
  if (!state.visualProfileSum.every(finite) || !state.visualProfileCount.every((item) => finite(item) && item >= 0)) return undefined
  if (!state.tileDurationsMs.every((item) => finite(item) && item >= 0 && item < 60 * 60_000)) return undefined

  return {
    width: state.width,
    height: state.height,
    tileHeight: state.tileHeight,
    overlap: state.overlap,
    nextTileIndex: Math.floor(state.nextTileIndex),
    boxes: state.boxes.map((box) => ({ ...box, text: box.text.slice(0, 256), bbox: { ...box.bbox } })),
    texts: state.texts.map((text) => text.slice(0, 4000)),
    visualColors: state.visualColors.map(([rgb, amount]) => [rgb.slice(0, 64), amount]),
    visualProfileSum: [...state.visualProfileSum],
    visualProfileCount: [...state.visualProfileCount],
    visualLuma: state.visualLuma,
    visualCount: state.visualCount,
    retryCount: Math.floor(state.retryCount),
    tileDurationsMs: [...state.tileDurationsMs],
    startedAt: state.startedAt,
  }
}

export function sanitizeOcrTileResumeMap(value: unknown) {
  const result: Record<string, OcrTileResumeState> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>).slice(0, SECURITY_LIMITS.maxImagesPerBatch)) {
    if (!/^sample-sha256-v1:\d+:[a-f0-9]{64}$/i.test(key)) continue
    const state = sanitizeOcrTileResumeState(candidate)
    if (state) result[key] = state
  }
  return result
}
