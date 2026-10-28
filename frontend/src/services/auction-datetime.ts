const zone = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function auctionDateParts(value: string) {
  if (!Number.isFinite(Date.parse(value))) return { date: '', time: '' }
  const parts = Object.fromEntries(zone.formatToParts(new Date(value)).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// Resolve wall-clock minutes using IANA rules, independently of the device timezone.
// Reject gaps and overlaps rather than silently choosing a different instant.
export function auctionDateInstant(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || Number(date.slice(0, 4)) < 1000) return ''
  const local = `${date}T${time}:00Z`, wall = Date.parse(local)
  if (!Number.isFinite(wall) || new Date(wall).toISOString() !== `${date}T${time}:00.000Z`) return ''
  const offsets = new Set<number>()
  for (const hours of [-36, 0, 36]) {
    const probe = wall + hours * 3600000
    const parts = auctionDateParts(new Date(probe).toISOString())
    offsets.add(Date.parse(`${parts.date}T${parts.time}:00Z`) - probe)
  }
  const matches = [...offsets].map(offset => new Date(wall - offset).toISOString()).filter(value => {
    const parts = auctionDateParts(value)
    return parts.date === date && parts.time === time
  })
  return matches.length === 1 ? matches[0]! : ''
}

export function auctionDatePreview(date: string, time: string): string {
  return `${date.split('-').reverse().join('/')} às ${time} — horário de Brasília`
}
