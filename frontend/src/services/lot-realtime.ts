export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable'
export interface LotSocket {
  connected: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  emit(event: string, ...args: any[]): unknown
  connect(): unknown
  disconnect(): unknown
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const money = (v: unknown) => typeof v === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/.test(v) && BigInt(v.replace('.', '')) > 0n

// Public notifications only invalidate GET snapshots. They never authorize a bid.
export function watchLot(socket: LotSocket, lotId: string, auctionId: string, changed: () => void, status: (value: ConnectionState) => void) {
  let disposed = false, joined = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined
  const seen = new Set<string>()
  const remember = (key: string) => {
    if (seen.has(key)) return
    seen.add(key); if (seen.size > 500) seen.delete(seen.values().next().value!)
    changed()
  }
  const join = () => {
    if (disposed || !socket.connected) return
    const current = ++generation; joined = false; clearTimeout(timer)
    status('connecting')
    timer = setTimeout(() => {
      if (disposed || generation !== current) return
      generation++; status('unavailable')
    }, 8000)
    socket.emit('lot:join', { lotId }, (ack: unknown) => {
      if (disposed || current !== generation) return
      // Consume this acknowledgement, including rejections, exactly once.
      generation++
      clearTimeout(timer)
      if (!object(ack) || ack.ok !== true || ack.lotId !== lotId) { status('unavailable'); return }
      joined = true; status('connected'); changed()
    })
  }
  const disconnected = (reason: unknown) => {
    generation++; joined = false; clearTimeout(timer); status('reconnecting')
    if (reason === 'io server disconnect' && !disposed) socket.connect()
  }
  const handlers: Record<string, (...args: any[]) => void> = {
    connect: join,
    disconnect: disconnected,
    connect_error: () => { generation++; clearTimeout(timer); joined = false; status('reconnecting') },
    'bid:created': (v: unknown) => {
      if (!joined || !object(v) || v.lotId !== lotId || !uuid(v.bidId) || !money(v.amount) || !date(v.createdAt) || !Number.isSafeInteger(v.sequence) || Number(v.sequence) < 1) return
      remember(`bid:${v.bidId}`)
    },
    'lot:extended': (v: unknown) => {
      if (!joined || !object(v) || v.lotId !== lotId || !uuid(v.triggerBidId) || !date(v.previousEndsAt) || !date(v.endsAt) || Date.parse(String(v.endsAt)) <= Date.parse(String(v.previousEndsAt))) return
      remember(`extended:${v.triggerBidId}:${v.endsAt}`)
    },
    'lot:closed': (v: unknown) => {
      if (!joined || !object(v) || v.lotId !== lotId || v.auctionId !== auctionId || !['SOLD', 'UNSOLD'].includes(String(v.status)) || !date(v.closedAt)) return
      remember(`closed:${v.closedAt}`)
    },
    'auction:closed': (v: unknown) => {
      if (!joined || !object(v) || v.auctionId !== auctionId || v.status !== 'CLOSED' || !date(v.closedAt)) return
      remember(`auction:${v.closedAt}`)
    },
  }
  for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler)
  status('connecting')
  if (socket.connected) join(); else socket.connect()
  const stop = () => {
    if (disposed) return
    disposed = true; generation++; joined = false; clearTimeout(timer)
    for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler)
    if (socket.connected) socket.emit('lot:leave', { lotId })
    socket.disconnect()
  }
  return { stop, retry: () => { if (!disposed) { if (socket.connected) join(); else socket.connect() } } }
}
