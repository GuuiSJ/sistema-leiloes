import type { ConnectionState } from '../../services/lot-realtime'

export function LiveConnection({ connection, updating, failed, retry }: { connection: ConnectionState; updating: boolean; failed: boolean; retry: () => void }) {
  const ready = connection === 'connected' && !updating && !failed
  const message = failed ? 'Não foi possível atualizar os dados.' : updating ? 'Sincronizando dados do lote...' : ready ? 'Acompanhamento em tempo real conectado' : connection === 'reconnecting' ? 'Reconectando ao tempo real...' : connection === 'unavailable' ? 'Tempo real indisponível.' : 'Conectando ao tempo real...'
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
    <p role="status" className="flex items-center gap-2"><span aria-hidden="true" className={`size-2 rounded-full ${ready ? 'bg-positive' : 'bg-muted'}`} />{message}</p>
    <button type="button" onClick={retry} className="min-h-10 font-medium text-accent">Atualizar dados</button>
    {!ready && <p className="w-full">Os dados podem estar desatualizados. Novos envios aguardam sincronização e elegibilidade.</p>}
  </div>
}
