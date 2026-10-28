import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { API_BASE_URL, ApiError } from '../services/api'
import { getAuction, getBidHistory, getLot, type Auction, type Bid, type Lot, type Page } from '../services/auctions'
import { watchLot, type ConnectionState } from '../services/lot-realtime'
import { getRoomClock, type RoomClock } from '../services/live-room'

interface Snapshot { auction: Auction; lot: Lot; history: Page<Bid>; clock: RoomClock | null }
export function useLiveLot(auctionId: string, lotId: string) {
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const refresh = useRef<() => void>(() => {})
  useEffect(() => {
    let disposed = false, running = false, dirty = false, timer: ReturnType<typeof setTimeout> | undefined
    let connectionState: ConnectionState = 'connecting'
    const abort = new AbortController()
    setData(null); setLoading(true); setError(null)
    async function load() {
      if (disposed || running) { dirty = true; return }
      running = true; dirty = false; setLoading(true)
      try {
        const [auction, lot, history, sample] = await Promise.all([getAuction(auctionId, abort.signal), getLot(auctionId, lotId, abort.signal), getBidHistory(lotId, 1, abort.signal), getRoomClock(lotId, abort.signal).catch(() => null)])
        const clock = sample && sample.auctionId === auction.id && sample.lotStatus === lot.status && sample.auctionStatus === auction.status && sample.endsAt === lot.endsAt ? sample : null
        if (!disposed) { setData({ auction, lot, history, clock }); setError(null) }
      } catch (error) {
        if (!disposed) setError(error instanceof ApiError ? error : new ApiError('Não foi possível atualizar este lote.'))
      } finally {
        running = false
        if (!disposed) {
          if (dirty) { timer = setTimeout(() => void load(), 100) }
          else setLoading(false)
        }
      }
    }
    function invalidate() {
      if (disposed) return
      setRevision(v => v + 1); setLoading(true); dirty = true
      if (!running) { clearTimeout(timer); timer = setTimeout(() => void load(), 100) }
    }
    // No JWT: the backend exposes only public lot-room notifications.
    const socket = io(API_BASE_URL, { autoConnect: false, forceNew: true, reconnection: true, reconnectionDelayMax: 10000, timeout: 10000, withCredentials: false })
    const watch = watchLot(socket, lotId, auctionId, invalidate, state => { connectionState = state; if (!disposed) setConnection(state) })
    refresh.current = () => { invalidate(); if (connectionState !== 'connected') watch.retry() }
    void load()
    return () => { disposed = true; refresh.current = () => {}; clearTimeout(timer); abort.abort(); watch.stop() }
  }, [auctionId, lotId])
  return { data, error, loading, revision, connection, syncReady: connection === 'connected' && !loading && !error, retry: () => refresh.current() }
}
