import assert from 'node:assert/strict'
import fs from 'node:fs'

const helper = fs.readFileSync(new URL('../src/lib/externalImportConflicts.ts', import.meta.url), 'utf8')
const screen = fs.readFileSync(new URL('../src/components/ExternalImport.tsx', import.meta.url), 'utf8')
const review = fs.readFileSync(new URL('../src/components/ExternalImportConflictReview.tsx', import.meta.url), 'utf8')

assert.match(helper, /Math\.floor\(time \/ 60_000\)/)
assert.match(helper, /tx\.type/)
assert.match(helper, /amountKey\(tx\.amount\)/)
assert.match(helper, /tx\.currency/)
assert.match(helper, /tx\.accountId/)
assert.match(helper, /same-source/)
assert.match(helper, /same-minute/)
assert.match(helper, /id: conflict\.existing\.id/)
assert.match(screen, /findExternalImportConflicts/)
assert.match(screen, /pendingConflicts/)
assert.match(screen, /conflictDecisions/)
assert.match(screen, /replaceExternalImportConflict/)
assert.match(review, /Ignore all duplicates/)
assert.match(review, /Replace all with imported data/)
assert.match(review, /PAGE_SIZE = 50/)
console.log('External import conflict regression checks passed.')
