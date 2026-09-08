import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { localizeError, useI18n } from '../i18n'
import { Button } from './ui'

export function ImageViewer({ imageId, onClose }: { imageId: string; onClose: () => void }) {
  const { repository } = useWallet()
  const { t } = useI18n()
  const [url, setUrl] = useState<string>()
  const [name, setName] = useState('screenshot')
  const [error, setError] = useState<string>()

  useEffect(() => {
    let objectUrl: string | undefined
    void (async () => {
      try {
        const data = await repository?.getImageBlob(imageId)
        if (!data) throw new Error(t('image.notFound'))
        objectUrl = URL.createObjectURL(data.blob)
        setName(data.originalName)
        setUrl(objectUrl)
      } catch (e) {
        setError(localizeError(e, t, 'image.openError'))
      }
    })()
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [imageId, repository, t])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/80 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <div className="truncate text-sm font-semibold text-stone-800 dark:text-stone-100">{name}</div>
          <div className="flex gap-2">
            {url && <a href={url} download={name} className="inline-flex items-center justify-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700 transition hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"><Download size={16} /> {t('image.saveDecrypted')}</a>}
            <Button variant="ghost" onClick={onClose}><X size={18} /></Button>
          </div>
        </div>
        <div className="overflow-auto bg-stone-100 p-3 text-center dark:bg-stone-950">
          {error ? <div className="p-10 text-rose-500">{error}</div> : url ? <img src={url} alt={name} className="mx-auto max-h-[80vh] max-w-full rounded-lg" /> : <div className="p-10 text-stone-500">{t('image.decrypting')}</div>}
        </div>
      </div>
    </div>
  )
}
