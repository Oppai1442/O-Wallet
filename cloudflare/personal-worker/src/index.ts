export interface Env {
  STATE: KVNamespace
  PAIRING_TOKEN: string
  ALLOWED_ORIGIN?: string
}

const VERSION = '0.1.0'
const DEFAULT_ORIGIN = 'https://oppai1442.github.io'
const HEARTBEAT_KEY = 'system:cron-last-run'

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  const allowed = env.ALLOWED_ORIGIN?.trim() || DEFAULT_ORIGIN
  const allowOrigin = origin && origin === allowed ? origin : allowed
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(request: Request, env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  })
}

function authorized(request: Request, env: Env) {
  const expected = env.PAIRING_TOKEN?.trim()
  if (!expected || expected.length < 24) return false
  const header = request.headers.get('Authorization') ?? ''
  return header === `Bearer ${expected}`
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    if (request.method !== 'GET') return json(request, env, { ok: false, error: 'method_not_allowed' }, 405)

    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return json(request, env, {
        ok: true,
        service: 'o-wallet-personal-cloud',
        version: VERSION,
      })
    }

    if (url.pathname === '/v1/capabilities') {
      if (!authorized(request, env)) return json(request, env, { ok: false, error: 'unauthorized' }, 401)
      const cronLastRun = await env.STATE.get(HEARTBEAT_KEY)
      return json(request, env, {
        ok: true,
        service: 'o-wallet-personal-cloud',
        version: VERSION,
        cronLastRun,
        capabilities: {
          health: true,
          authenticatedPairing: true,
          kvState: true,
          cronHeartbeat: true,
          automationInbox: false,
          pushNotifications: false,
          scheduledActions: false,
        },
      })
    }

    return json(request, env, { ok: false, error: 'not_found' }, 404)
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await env.STATE.put(HEARTBEAT_KEY, new Date().toISOString())
  },
} satisfies ExportedHandler<Env>
