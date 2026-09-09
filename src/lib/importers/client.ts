import { reportDiagnostic, validateSqliteBackupFile } from '../security'
import type { ExternalImportBundle, ExternalImportWorkerRequest, ExternalImportWorkerResponse } from './types'

const IMPORT_TIMEOUT_MS = 90_000

export async function parseExternalBackup(file: File): Promise<ExternalImportBundle> {
  await validateSqliteBackupFile(file)

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/sqliteImport.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(new Error('error.importTimedOut'))
    }, IMPORT_TIMEOUT_MS)

    const finish = () => {
      window.clearTimeout(timer)
      worker.terminate()
    }

    worker.onerror = (event) => {
      if (settled) return
      settled = true
      finish()
      reportDiagnostic('external-import-worker', event.message)
      reject(new Error('error.importWorkerFailed'))
    }

    worker.onmessage = (event: MessageEvent<ExternalImportWorkerResponse>) => {
      if (settled) return
      settled = true
      finish()
      if (event.data.type === 'result') resolve(event.data.bundle)
      else reject(new Error(event.data.message.startsWith('error.') ? event.data.message : 'error.importReadFailed'))
    }

    void file.arrayBuffer()
      .then((buffer) => {
        if (settled) return
        const payload: ExternalImportWorkerRequest = { type: 'parse', fileName: file.name, buffer }
        worker.postMessage(payload, [buffer])
      })
      .catch((error) => {
        if (settled) return
        settled = true
        finish()
        reportDiagnostic('external-import-read', error)
        reject(new Error('error.importReadFailed'))
      })
  })
}
