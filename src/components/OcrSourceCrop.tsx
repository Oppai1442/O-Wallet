import { useEffect, useState } from 'react'
import type { OcrFieldEvidence } from '../types'

export function OcrSourceCrop({
  file,
  bbox,
  sourceWidth,
  sourceHeight,
  evidence,
  className = '',
  maxWidth = 900,
  maxHeight = 720,
}: {
  file?: File
  bbox?: { x: number; y: number; width: number; height: number }
  sourceWidth?: number
  sourceHeight?: number
  evidence?: OcrFieldEvidence
  className?: string
  maxWidth?: number
  maxHeight?: number
}) {
  const [url, setUrl] = useState<string>()
  const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number }>()

  useEffect(() => {
    let disposed = false
    let objectUrl: string | undefined
    if (!file || !bbox || !sourceWidth || !sourceHeight || bbox.width <= 0 || bbox.height <= 0) {
      setUrl(undefined)
      setCrop(undefined)
      return
    }

    const padding = Math.max(24, Math.min(160, Math.round(bbox.height * 0.12)))
    const x = Math.max(0, Math.floor(bbox.x))
    const y = Math.max(0, Math.floor(bbox.y - padding))
    const width = Math.max(1, Math.min(sourceWidth - x, Math.ceil(bbox.width)))
    const height = Math.max(1, Math.min(sourceHeight - y, Math.ceil(bbox.height + padding * 2)))
    const nextCrop = { x, y, width, height }
    setCrop(nextCrop)

    void (async () => {
      let bitmap: ImageBitmap | undefined
      try {
        bitmap = await createImageBitmap(file, x, y, width, height)
        if (disposed) return
        const scale = Math.min(1, maxWidth / width, maxHeight / height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) return
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88))
        if (!blob || disposed) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        if (!disposed) setUrl(undefined)
      } finally {
        bitmap?.close()
      }
    })()

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [bbox?.height, bbox?.width, bbox?.x, bbox?.y, file, maxHeight, maxWidth, sourceHeight, sourceWidth])

  if (!url || !crop) {
    return <div className={`flex items-center justify-center bg-stone-100 text-xs text-stone-400 dark:bg-stone-950 ${className}`}>…</div>
  }

  const evidenceStyle = evidence ? {
    left: `${Math.max(0, ((evidence.bbox.x - crop.x) / crop.width) * 100)}%`,
    top: `${Math.max(0, ((evidence.bbox.y - crop.y) / crop.height) * 100)}%`,
    width: `${Math.max(1, Math.min(100, (evidence.bbox.width / crop.width) * 100))}%`,
    height: `${Math.max(2, Math.min(100, (evidence.bbox.height / crop.height) * 100))}%`,
  } : undefined

  return <div className={`relative overflow-hidden bg-stone-100 dark:bg-stone-950 ${className}`}>
    <img src={url} alt="" draggable={false} className="h-full w-full select-none object-contain" />
    {evidenceStyle && <div className="pointer-events-none absolute z-10 rounded border-2 border-blue-500 bg-blue-500/15 shadow-[0_0_0_9999px_rgba(0,0,0,.08)]" style={evidenceStyle}/>}
  </div>
}
