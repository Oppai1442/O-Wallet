import type { ExternalImportBundle, ExternalImportWorkerRequest, ExternalImportWorkerResponse } from './types'

export function parseExternalBackup(file: File): Promise<ExternalImportBundle> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/sqliteImport.worker.ts', import.meta.url), { type: 'module' })
    let settled = false

    const finish = () => worker.terminate()
    worker.onerror = (event) => {
      if (settled) return
      settled = true
      finish()
      reject(new Error(event.message || 'Could not read the backup file.'))
    }

    worker.onmessage = (event: MessageEvent<ExternalImportWorkerResponse>) => {
      if (settled) return
      settled = true
      finish()
      if (event.data.type === 'result') resolve(event.data.bundle)
      else reject(new Error(event.data.message))
    }

    void file.arrayBuffer()
      .then((buffer) => {
        const payload: ExternalImportWorkerRequest = { type: 'parse', fileName: file.name, buffer }
        worker.postMessage(payload, [buffer])
      })
      .catch((error) => {
        if (settled) return
        settled = true
        finish()
        reject(error)
      })
  })
}
