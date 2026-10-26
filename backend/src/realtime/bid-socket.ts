import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { frontendOrigin } from "../config/http";
import { getPrisma } from "../lib/prisma";
import { validateId } from "../modules/bids/bid.validation";
import { bidEvents, type BidEventBus, type BidCreatedEvent, type LotExtendedEvent } from "./bid-events";
import { settlementEvents, type SettlementEventBus, type LotClosedEvent, type AuctionClosedEvent } from "./settlement-events";

export type RoomAck = { ok: true; lotId: string } | { ok: false; error: { code: string; message: string } };
interface ClientEvents {
  "lot:join": (payload: unknown, ack?: (result: RoomAck) => void) => void;
  "lot:leave": (payload: unknown, ack?: (result: RoomAck) => void) => void;
}
interface ServerEvents { "bid:created": (event: Readonly<BidCreatedEvent>) => void; "lot:extended": (event: Readonly<LotExtendedEvent>) => void; "lot:closed": (event: Readonly<LotClosedEvent>) => void; "auction:closed": (event: Readonly<AuctionClosedEvent>) => void }
interface Options {
  events?: BidEventBus;
  settlementEvents?: SettlementEventBus;
  lotExists?: (lotId: string) => Promise<boolean>;
  maxRooms?: number;
  maxOperations?: number;
}
export function attachBidSocket(server: HttpServer, options: Options = {}) {
  const origin = frontendOrigin();
  const io = new Server<ClientEvents, ServerEvents>(server, {
    cors: { origin }, maxHttpBufferSize: 1024,
    // CORS alone does not restrict WebSocket origins. Native clients may omit Origin.
    allowRequest: (req, callback) => callback(null, req.headers.origin === undefined || req.headers.origin === origin),
  });
  const exists = options.lotExists ?? (async id => !!await getPrisma().lot.findUnique({ where: { id }, select: { id: true } }));
  const unsubscribe = (options.events ?? bidEvents).subscribe(payload => { io.to(`lot:${payload.lotId}`).emit("bid:created", payload); });
  const unsubscribeExtensions = (options.events ?? bidEvents).subscribeExtensions(payload => { io.to(`lot:${payload.lotId}`).emit("lot:extended", payload); });
  const closing = options.settlementEvents ?? settlementEvents;
  const unsubscribeLots = closing.subscribeLot(payload => { io.to(`lot:${payload.lotId}`).emit("lot:closed", payload); });
  const unsubscribeAuctions = closing.subscribeAuction(event => {
    if (event.lotIds.length) io.to(event.lotIds.map(id => `lot:${id}`)).emit("auction:closed", { auctionId: event.auctionId, status: event.status, closedAt: event.closedAt });
  });
  server.once("close", () => { unsubscribe(); unsubscribeExtensions(); unsubscribeLots(); unsubscribeAuctions(); });
  io.on("connection", socket => {
    const subscriptions = new Set<string>();
    let windowStart = Date.now(), operations = 0, pending = 0;
    let tail = Promise.resolve();
    for (const event of ["lot:join", "lot:leave"] as const) socket.on(event, (payload, acknowledgement) => {
      const ack = (value: RoomAck) => { if (typeof acknowledgement === "function") acknowledgement(value); };
      const error = (code: string, message: string) => ack({ ok: false, error: { code, message } });
      if (Date.now() - windowStart >= 10000) { windowStart = Date.now(); operations = 0; }
      if (++operations > (options.maxOperations ?? 30) || pending >= 10) { error("RATE_LIMITED", "Limite de operações por conexão atingido."); return; }
      let lotId: string;
      try {
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 1 || !("lotId" in payload)) throw new Error();
        lotId = validateId(payload.lotId);
      } catch { error("INVALID_REQUEST", "Envie somente { lotId: UUID válido }."); return; }
      pending++;
      tail = tail.then(async () => {
        if (!socket.connected) return;
        if (event === "lot:join") {
          if (!subscriptions.has(lotId)) {
            if (subscriptions.size >= (options.maxRooms ?? 20)) { error("SUBSCRIPTION_LIMIT", "Limite de lotes por conexão atingido."); return; }
            if (!await exists(lotId)) { error("NOT_FOUND", "Lote não encontrado."); return; }
            if (!socket.connected) return;
            await socket.join(`lot:${lotId}`); subscriptions.add(lotId);
          }
        } else { await socket.leave(`lot:${lotId}`); subscriptions.delete(lotId); }
        ack({ ok: true, lotId });
      }).catch(() => { error("INTERNAL_ERROR", "Não foi possível alterar a inscrição."); }).finally(() => { pending--; });
    });
    socket.once("disconnect", () => { subscriptions.clear(); });
  });
  return io;
}
