import assert from 'node:assert/strict'
import fs from 'node:fs'

const watchdog = fs.readFileSync(new URL('../src/lib/releaseWatchdog.ts', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const vite = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

assert.match(watchdog, /OppaiDataStorage\/Data\/main\/o-project\/releases\/o-wallet\.json/)
assert.match(watchdog, /cache: 'no-store'/)
assert.match(watchdog, /registration\.update\(\)/)
assert.match(watchdog, /controllerchange/)
assert.match(watchdog, /minSupportedVersion/)
assert.match(watchdog, /forceUpdate/)
assert.match(watchdog, /6 \* 60 \* 60 \* 1000/)
assert.match(main, /startReleaseWatchdog\(\)/)
assert.match(vite, /https:\/\/raw\.githubusercontent\.com/)
assert.doesNotMatch(watchdog, /indexedDB\.deleteDatabase/)
assert.doesNotMatch(watchdog, /localStorage\.clear\(\)/)

console.log('Release watchdog regression checks passed.')
