import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/lib/externalPhotoImport.ts', import.meta.url), 'utf8')
const externalImport = fs.readFileSync(new URL('../src/components/ExternalImport.tsx', import.meta.url), 'utf8')
const repository = fs.readFileSync(new URL('../src/lib/repository.ts', import.meta.url), 'utf8')
const sync = fs.readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8')

assert.match(source, /webkitRelativePath/)
assert.match(source, /commonTrailingSegments/)
assert.match(source, /fileSize === file\.size/)
assert.match(source, /external-photo:/)
assert.match(externalImport, /webkitdirectory/)
assert.match(externalImport, /matchExternalPhotoReferences/)
assert.match(externalImport, /uploadImageRemoteOnly/)
assert.match(externalImport, /workerCount = Math\.min\(4/)
assert.match(repository, /async prepareImage/)
assert.match(sync, /uploadPreparedImageToDrive/)
assert.doesNotMatch(sync, /uploadPreparedImageToDrive[\s\S]{0,1200}db\.images\.put/)

console.log('External photo import regression checks passed.')
