const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dates = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
export function formatMoney(value: string | null | undefined): string {
  if (!value || !/^\d+\.\d{2}$/.test(value)) return '—'
  const [whole, fraction] = value.split('.')
  // Preserve Decimal(18,2) cents instead of rounding through a floating-point Number.
  return currency.formatToParts(BigInt(whole!)).map(part => part.type === 'fraction' ? fraction : part.value).join('')
}
export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? dates.format(date) : 'Data não informada'
}
export function validPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}
