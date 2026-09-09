let pickerPromise: Promise<void> | undefined

function developerKey() {
  return (import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim()
}

function projectNumberFromClientId() {
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
  return clientId.split('-')[0] || ''
}

export function googlePickerConfigured() {
  return Boolean(developerKey() && projectNumberFromClientId())
}

function loadPickerScript() {
  if (pickerPromise) return pickerPromise
  pickerPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-owallet-google-picker]')
    const finish = () => {
      const gapi = (window as any).gapi
      if (!gapi?.load) { reject(new Error('error.sharedPickerLoad')); return }
      gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('error.sharedPickerLoad')) })
    }
    if (existing) { finish(); return }
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.async = true
    script.defer = true
    script.dataset.owalletGooglePicker = '1'
    script.onload = finish
    script.onerror = () => reject(new Error('error.sharedPickerLoad'))
    document.head.appendChild(script)
  })
  return pickerPromise
}

/**
 * Explicitly opens a single Drive file with this app. This is the narrow authorization
 * step required by the drive.file scope for a collaborator-owned/shared file.
 */
export async function authorizeSpecificDriveFile(accessToken: string, fileId: string) {
  if (!googlePickerConfigured()) throw new Error('error.sharedApiKeyMissing')
  await loadPickerScript()
  const google = (window as any).google
  if (!google?.picker) throw new Error('error.sharedPickerLoad')
  return new Promise<void>((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setFileIds(fileId)
      .setIncludeFolders(false)
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(developerKey())
      .setAppId(projectNumberFromClientId())
      .setTitle('O-Wallet')
      .setCallback((data: any) => {
        const action = data?.action
        if (action === google.picker.Action.PICKED) {
          const selected = data?.docs?.[0]?.id
          if (selected === fileId) resolve()
          else reject(new Error('error.sharedPickerWrongFile'))
        } else if (action === google.picker.Action.CANCEL) {
          reject(new Error('error.sharedPickerCancelled'))
        }
      })
      .build()
    picker.setVisible(true)
  })
}
