type Handler = (...args: any[]) => void
export function io() {
  const handlers = new Map<string, Set<Handler>>()
  const socket = {
    connected: false,
    on(name: string, fn: Handler) { const set = handlers.get(name) ?? new Set(); set.add(fn); handlers.set(name, set); return socket },
    off(name: string, fn: Handler) { handlers.get(name)?.delete(fn); return socket },
    emit(name: string, value: { lotId: string }, ack?: Handler) { if (name === 'lot:join') queueMicrotask(() => ack?.({ ok: true, lotId: value.lotId })); return socket },
    connect() { queueMicrotask(() => { socket.connected = true; socket.receive('connect') }); return socket },
    disconnect() { socket.connected = false; return socket },
    receive(name: string, ...args: any[]) { handlers.get(name)?.forEach(fn => fn(...args)) },
  }
  Object.assign((window as unknown as { roomTest: object }).roomTest, { socket })
  return socket
}
