export interface ReleaseManifest {
  schemaVersion: 1
  app: 'o-wallet'
  version: string
  minSupportedVersion?: string
  build?: string
  releasedAt?: string
  forceUpdate?: boolean
  updatePolicy?: 'auto' | 'notify'
}

const RELEASE_MANIFEST_URL = 'https://raw.githubusercontent.com/OppaiDataStorage/Data/main/o-project/releases/o-wallet.json'
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const UPDATE_SETTLE_MS = 8_000
const RELOAD_GUARD_KEY = 'owallet.release-watchdog.reload'
const HARD_RECOVERY_GUARD_KEY = 'owallet.release-watchdog.recovery'

function parseVersion(value: string) {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const
}

export function compareReleaseVersions(left: string, right: string) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function validManifest(value: unknown): value is ReleaseManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<ReleaseManifest>
  return manifest.schemaVersion === 1
    && manifest.app === 'o-wallet'
    && typeof manifest.version === 'string'
    && Boolean(parseVersion(manifest.version))
    && (!manifest.minSupportedVersion || Boolean(parseVersion(manifest.minSupportedVersion)))
}

async function fetchReleaseManifest() {
  const url = new URL(RELEASE_MANIFEST_URL)
  url.searchParams.set('t', String(Date.now()))
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error('release manifest unavailable')
  const value: unknown = await response.json()
  if (!validManifest(value)) throw new Error('release manifest invalid')
  return value
}

function guardedReload(reason: string) {
  const now = Date.now()
  const previous = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
  if (now - previous < 20_000) return false
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(now))
  const url = new URL(window.location.href)
  url.searchParams.set('ow-update', reason)
  url.searchParams.set('ow-build', String(now))
  window.location.replace(url.href)
  return true
}

async function clearOwalletCaches() {
  if (!('caches' in window)) return
  const keys = await caches.keys()
  await Promise.all(keys.filter((key) => /workbox|o-wallet|precache/i.test(key)).map((key) => caches.delete(key)))
}

async function hardRecoverServiceWorker() {
  const now = Date.now()
  const previous = Number(localStorage.getItem(HARD_RECOVERY_GUARD_KEY) || 0)
  if (now - previous < 6 * 60 * 60 * 1000) return false
  localStorage.setItem(HARD_RECOVERY_GUARD_KEY, String(now))

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations
      .filter((registration) => registration.scope.startsWith(window.location.origin))
      .map((registration) => registration.unregister()))
  }
  await clearOwalletCaches()
  return guardedReload('recovery')
}

async function requestServiceWorkerUpdate() {
  if (!('serviceWorker' in navigator)) return false
  const registration = await navigator.serviceWorker.ready
  let controllerChanged = false
  const onControllerChange = () => {
    controllerChanged = true
    guardedReload('controller')
  }
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true })
  try {
    await registration.update()
    await new Promise((resolve) => window.setTimeout(resolve, UPDATE_SETTLE_MS))
    return controllerChanged
  } finally {
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }
}

export function startReleaseWatchdog() {
  if (import.meta.env.DEV || import.meta.env.VITE_OCR_E2E === '1') return () => undefined
  let stopped = false
  let running = false

  const check = async () => {
    if (stopped || running || document.visibilityState === 'hidden' || !navigator.onLine) return
    running = true
    try {
      const manifest = await fetchReleaseManifest()
      const newerAvailable = compareReleaseVersions(manifest.version, __APP_VERSION__) > 0
      const belowMinimum = Boolean(manifest.minSupportedVersion)
        && compareReleaseVersions(__APP_VERSION__, manifest.minSupportedVersion!) < 0
      if (!newerAvailable && !belowMinimum) {
        localStorage.removeItem(HARD_RECOVERY_GUARD_KEY)
        return
      }

      const controllerChanged = await requestServiceWorkerUpdate()
      if (controllerChanged) return

      // A normal release can take a short time to propagate from the registry to Pages.
      // Only force cache/SW recovery when the manifest explicitly requires it or the
      // running client is below the supported floor.
      if (manifest.forceUpdate || belowMinimum) await hardRecoverServiceWorker()
    } catch {
      // Release metadata is advisory. Offline/registry failures must never block O-Wallet.
    } finally {
      running = false
    }
  }

  const onVisible = () => { if (document.visibilityState === 'visible') void check() }
  const onOnline = () => void check()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS)
  window.setTimeout(() => void check(), 2_000)

  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.clearInterval(timer)
  }
}
