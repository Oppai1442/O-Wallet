import type { TransactionType } from '../types'
import { parseDateTimeText } from './ocr'
import { SECURITY_LIMITS } from './security'

export const AI_OPENROUTER_KEY_SECRET = 'ai:openrouter:key'
export const OPENROUTER_CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export interface AiTransactionCandidate {
  type?: TransactionType
  amount?: number
  currency?: string
  occurredAt?: string
  merchant?: string
  balanceAfter?: number
  description?: string
}

export interface AiVisionConfig {
  endpoint: string
  model: string
  apiKey: string
}

function assertOpenRouterEndpoint(raw: string) {
  if (!raw || raw.length > SECURITY_LIMITS.maxAiEndpointChars) throw new Error('error.aiInvalidEndpoint')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('error.aiInvalidEndpoint')
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'openrouter.ai'
    || url.username
    || url.password
    || url.pathname.replace(/\/+$/, '') !== '/api/v1/chat/completions'
  ) throw new Error('error.aiInvalidEndpoint')
  url.hash = ''
  return url.href
}

function assertModel(raw: string) {
  const model = raw.trim()
  if (!model || model.length > SECURITY_LIMITS.maxAiModelChars || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error('error.aiInvalidModel')
  }
  return model
}

function assertApiKey(raw: string) {
  const key = raw.trim()
  if (!key || key.length > SECURITY_LIMITS.maxAiApiKeyChars || /[\r\n]/.test(key)) throw new Error('error.aiMissingKey')
  return key
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('error.aiImageRead'))
    reader.onerror = () => reject(new Error('error.aiImageRead'))
    reader.readAsDataURL(file)
  })
}

function extractTextContent(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const value = part as Record<string, unknown>
      return value.type === 'text' && typeof value.text === 'string' ? value.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractJsonObject(raw: string) {
  const text = raw.trim().slice(0, SECURITY_LIMITS.maxAiResponseChars)
  if (!text) throw new Error('error.aiEmptyResponse')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || text
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    const first = candidate.indexOf('{')
    const last = candidate.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1)) as unknown
      } catch {
        // handled below
      }
    }
    throw new Error('error.aiInvalidResponse')
  }
}

function finitePositive(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const normalized = value.replace(/[^\d.,-]/g, '').replace(/([.,])(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
    const parsed = Number(normalized)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return undefined
}

function shortString(value: unknown, max = 2_000) {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return clean ? clean.slice(0, max) : undefined
}

function normalizeOccurredAt(value: unknown) {
  const raw = shortString(value, 128)
  if (!raw) return undefined

  // A model is asked to return local bank time as YYYY-MM-DDTHH:mm:ss without
  // inventing a timezone. Interpret that shape in the user's device timezone.
  const local = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/)
  if (local) {
    const date = new Date(`${local[1]}T${local[2]}:${local[3] ?? '00'}`)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  const parsedByOcr = parseDateTimeText(raw)
  if (parsedByOcr) return parsedByOcr

  // Accept a real ISO instant only when the model explicitly returned an offset/Z.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const date = new Date(raw)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return undefined
}

function normalizeCandidate(value: unknown): AiTransactionCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('error.aiInvalidResponse')
  const obj = value as Record<string, unknown>
  const type = obj.type === 'expense' || obj.type === 'income' || obj.type === 'transfer' ? obj.type : undefined
  const currencyRaw = shortString(obj.currency, 16)?.toUpperCase().replace(/[^A-Z]/g, '')
  return {
    type,
    amount: finitePositive(obj.amount),
    currency: currencyRaw && currencyRaw.length >= 3 && currencyRaw.length <= 8 ? currencyRaw : undefined,
    occurredAt: normalizeOccurredAt(obj.occurredAt),
    merchant: shortString(obj.merchant),
    balanceAfter: finitePositive(obj.balanceAfter),
    description: shortString(obj.description, 4_000),
  }
}

const SYSTEM_PROMPT = `You extract exactly one financial transaction from a banking/payment screenshot or receipt.
Return ONLY one JSON object, with no markdown and no explanation.
Use this schema:
{
  "type": "expense" | "income" | "transfer" | null,
  "amount": number | null,
  "currency": string | null,
  "occurredAt": string | null,
  "merchant": string | null,
  "balanceAfter": number | null,
  "description": string | null
}
Rules:
- amount and balanceAfter must be positive numeric values without thousands separators.
- occurredAt should be local transaction time in YYYY-MM-DDTHH:mm:ss when visible. Do not invent a timezone.
- merchant is the recipient, merchant, beneficiary, sender, or place of payment shown by the transaction.
- description is the transfer message/memo/transaction description, without field labels such as "Nội dung:".
- Do not guess fields that are not visible or reasonably inferable; use null instead.
- Preserve names and transfer descriptions faithfully.
- The screenshot may be Vietnamese or English.`

export async function analyzeTransactionImage(file: File, config: AiVisionConfig): Promise<AiTransactionCandidate> {
  const endpoint = assertOpenRouterEndpoint(config.endpoint)
  const model = assertModel(config.model)
  const apiKey = assertApiKey(config.apiKey)
  const imageDataUrl = await fileToDataUrl(file)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 75_000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      body: JSON.stringify({
        model,
        provider: { data_collection: 'deny' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this image and extract the transaction fields.' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('error.aiUnauthorized')
      if (response.status === 429) throw new Error('error.aiRateLimited')
      if (response.status >= 500) throw new Error('error.aiProviderUnavailable')
      throw new Error('error.aiRequestFailed')
    }

    const json = await response.json() as Record<string, unknown>
    const choices = Array.isArray(json.choices) ? json.choices : []
    const first = choices[0]
    if (!first || typeof first !== 'object') throw new Error('error.aiEmptyResponse')
    const message = (first as Record<string, unknown>).message
    if (!message || typeof message !== 'object') throw new Error('error.aiEmptyResponse')
    const content = extractTextContent((message as Record<string, unknown>).content)
    const candidate = normalizeCandidate(extractJsonObject(content))
    if (!candidate.amount && !candidate.occurredAt && !candidate.merchant && !candidate.balanceAfter && !candidate.description) {
      throw new Error('error.aiNoFields')
    }
    return candidate
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('error.aiTimeout')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}
