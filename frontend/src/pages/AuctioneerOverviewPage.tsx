import { CarFront, Gavel, CalendarClock, Radio } from 'lucide-react'
import { Link } from 'react-router'
import { usePublicResource } from '../hooks/usePublicResource'
import { getOverview } from '../services/auctioneer'
import { AdminFeedback, AdminHeading } from '../components/auctioneer/AdminFeedback'

export function AuctioneerOverviewPage() {
  const resource = usePublicResource('auctioneer:overview', getOverview)
  const cards = resource.data ? [
    { label: 'Veículos cadastrados', value: resource.data.vehicles, icon: CarFront, to: 'veiculos' },
    { label: 'Leilões cadastrados', value: resource.data.auctions, icon: Gavel, to: 'leiloes' },
    { label: 'Leilões abertos', value: resource.data.open, icon: Radio, to: 'leiloes?status=OPEN' },
    { label: 'Leilões agendados', value: resource.data.scheduled, icon: CalendarClock, to: 'leiloes?status=SCHEDULED' },
  ] : []
  return <><AdminHeading title="Visão geral" description="Acompanhe os totais do catálogo. Atualize para ver os dados mais recentes." retry={resource.retry} />
    <AdminFeedback {...resource} empty={false}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, to }) => <Link key={label} to={to} className="rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-accent/40"><div className="mb-6 flex items-center justify-between"><span className="text-sm text-muted">{label}</span><Icon className="text-accent" size={22} aria-hidden="true" /></div><p className="text-4xl font-semibold tracking-tight">{value.toLocaleString('pt-BR')}</p></Link>)}</div></AdminFeedback>
    <div className="mt-6 rounded-2xl border border-line bg-surface p-6"><h3 className="font-semibold">Explore os lotes por leilão</h3><p className="mt-2 text-sm leading-6 text-muted">Consulte os veículos vinculados, preços iniciais, incrementos e prazos individuais.</p><Link to="lotes" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">Consultar lotes →</Link></div>
  </>
}
