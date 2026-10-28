import { useState } from 'react'
import { CarFront, ChevronLeft, ChevronRight } from 'lucide-react'
import { validPhotoUrl } from '../../services/formatters'

export function VehicleGallery({ images, label }: { images: string[]; label: string }) {
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState<string[]>([])
  const photos = [...new Set(images)].filter(url => validPhotoUrl(url) && !failed.includes(url))
  const selected = Math.min(index, Math.max(photos.length - 1, 0))
  const source = photos[selected]
  function move(direction: number) { setIndex((selected + direction + photos.length) % photos.length) }
  return <section aria-label="Galeria do veículo" className="overflow-hidden rounded-2xl border border-line bg-surface">
    <div className="relative aspect-[4/3] bg-canvas">
      {source ? <img src={source} alt={`${label} — foto ${selected + 1} de ${photos.length}`} referrerPolicy="no-referrer"
        onError={() => setFailed(previous => [...previous, source])} className="h-full w-full object-contain" /> :
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-muted"><CarFront size={64} strokeWidth={1.1} aria-hidden="true" /><p>Fotografias não disponíveis para este veículo.</p></div>}
      {photos.length > 1 && <>
        <button type="button" onClick={() => move(-1)} aria-label="Foto anterior" className="absolute top-1/2 left-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-navy/90 text-white transition-colors hover:bg-accent"><ChevronLeft aria-hidden="true" /></button>
        <button type="button" onClick={() => move(1)} aria-label="Próxima foto" className="absolute top-1/2 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-navy/90 text-white transition-colors hover:bg-accent"><ChevronRight aria-hidden="true" /></button>
      </>}
    </div>
    {photos.length > 1 && <div className="flex gap-3 overflow-x-auto p-4" aria-label="Escolher fotografia">
      {photos.map((url, i) => <button key={url} type="button" aria-label={`Ver foto ${i + 1}`} aria-pressed={selected === i} onClick={() => setIndex(i)}
        className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 ${selected === i ? 'border-accent' : 'border-transparent'}`}>
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(previous => [...previous, url])} className="h-full w-full object-cover" />
      </button>)}
    </div>}
  </section>
}
