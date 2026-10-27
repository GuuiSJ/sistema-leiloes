import type { Vehicle } from '../../services/auctions'
import { formatMoney } from '../../services/formatters'

export function VehicleSpecs({ vehicle }: { vehicle: Vehicle }) {
  const specs = [['Marca', vehicle.brand], ['Modelo', vehicle.model], ['Ano', String(vehicle.year)], ['Versão', vehicle.version || 'Não informada']]
  return <section aria-labelledby="vehicle-specs" className="rounded-2xl border border-line bg-surface p-6">
    <h3 id="vehicle-specs" className="text-lg font-semibold">Informações do veículo</h3>
    <dl className="mt-5 grid grid-cols-2 gap-5">{specs.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>)}</dl>
    {vehicle.description ? <p className="mt-6 whitespace-pre-line break-words text-sm leading-7 text-muted">{vehicle.description}</p> : <p className="mt-6 text-sm text-muted">Descrição não informada.</p>}
    {vehicle.fipeReferencePrice && <div className="mt-6 border-t border-line pt-5 text-sm"><p className="text-muted">Referência FIPE cadastrada · não verificada</p><p className="mt-1 font-semibold">{formatMoney(vehicle.fipeReferencePrice)}</p>{vehicle.fipeReferenceMonth && <p className="mt-1 text-xs text-muted">{vehicle.fipeReferenceMonth}</p>}</div>}
  </section>
}
