import { useState } from 'react'
import { CalendarDays, Clock3 } from 'lucide-react'
import { auctionDateInstant, auctionDateParts, auctionDatePreview } from '../../services/auction-datetime'
import { adminInput } from './AdminFeedback'

export function AuctionDateTimeField({ id, name, label, value, error, change }: {
  id: string; name: string; label: string; value: string; error?: string; change: (value: string) => void
}) {
  const [selection, setSelection] = useState(() => ({ source: value, ...auctionDateParts(value) }))
  // Sync external record changes while retaining partially selected inputs locally.
  const current = selection.source === value ? selection : { source: value, ...auctionDateParts(value) }
  function select(part: 'date' | 'time', next: string) {
    const updated = { ...current, [part]: next }
    const instant = auctionDateInstant(updated.date, updated.time)
    setSelection({ ...updated, source: instant })
    change(instant)
  }
  const invalid = current.date && current.time && !auctionDateInstant(current.date, current.time)
  return <fieldset className="min-w-0 space-y-2">
    <legend className="mb-2 text-sm font-medium">{label} *</legend>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" lang="pt-BR">
      {(['date', 'time'] as const).map(part => {
        const Icon = part === 'date' ? CalendarDays : Clock3
        return <div key={part} className="min-w-0">
          <label htmlFor={`${id}-${part}`} className="mb-1 flex items-center gap-2 text-xs text-muted"><Icon size={16} aria-hidden="true" />{part === 'date' ? 'Data' : 'Horário'}</label>
          <input id={`${id}-${part}`} name={`${name}-${part}`} type={part} required lang="pt-BR" min={part === 'date' ? '1000-01-01' : undefined} max={part === 'date' ? '9999-12-31' : undefined} step={part === 'time' ? 60 : undefined} value={current[part]} onChange={event => select(part, event.target.value)} aria-invalid={!!error || !!invalid} aria-describedby={`${id}-help`} className={`${adminInput} min-w-0 [color-scheme:light] dark:[color-scheme:dark]`} />
        </div>
      })}
    </div>
    <p id={`${id}-help`} className={`text-xs leading-5 ${error || invalid ? 'text-red-600 dark:text-red-300' : 'text-muted'}`} aria-live="polite">{error || (invalid ? 'Horário inexistente ou ambíguo no fuso de Brasília. Selecione outro horário.' : current.date && current.time ? auctionDatePreview(current.date, current.time) : 'Selecione a data e o horário de Brasília.')}</p>
  </fieldset>
}
