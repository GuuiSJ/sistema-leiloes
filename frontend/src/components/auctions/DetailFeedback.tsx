import { CircleAlert, LoaderCircle } from 'lucide-react'

export function DetailLoading({ label = 'Carregando detalhes...' }: { label?: string }) {
  return <div role="status" className="flex min-h-40 items-center justify-center gap-3 rounded-2xl border border-line bg-surface p-6 text-sm text-muted"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />{label}</div>
}
export function DetailError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="rounded-2xl border border-line bg-surface p-6">
    <CircleAlert size={24} className="mb-3 text-muted" aria-hidden="true" /><p className="text-sm leading-6">{message}</p>
    <button type="button" onClick={retry} className="mt-4 min-h-11 rounded-lg border border-line px-4 text-sm font-medium transition-colors hover:bg-accent/10">Tentar novamente</button>
  </div>
}
