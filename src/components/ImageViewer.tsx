import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { Button } from './ui'

export function ImageViewer({ imageId, onClose }: { imageId: string; onClose: () => void }) {
  const { repository } = useWallet()
  const [url, setUrl] = useState<string>()
  const [name, setName] = useState('screenshot')
  const [error, setError] = useState<string>()

  useEffect(() => {
    let objectUrl: string | undefined
    void (async () => {
      try {
        const data = await repository?.getImageBlob(imageId)
        if (!data) throw new Error('Không tìm thấy ảnh.')
        objectUrl = URL.createObjectURL(data.blob)
        setName(data.originalName)
        setUrl(objectUrl)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Không mở được ảnh.')
      }
    })()
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [imageId, repository])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</div>
          <div className="flex gap-2">
            {url && <a href={url} download={name} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"><Download size={16} /> Lưu bản giải mã</a>}
            <Button variant="ghost" onClick={onClose}><X size={18} /></Button>
          </div>
        </div>
        <div className="overflow-auto bg-slate-100 p-3 text-center dark:bg-slate-950">
          {error ? <div className="p-10 text-rose-500">{error}</div> : url ? <img src={url} alt={name} className="mx-auto max-h-[80vh] max-w-full rounded-lg" /> : <div className="p-10 text-slate-500">Đang decrypt ảnh…</div>}
        </div>
      </div>
    </div>
  )
}
