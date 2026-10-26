import { io as connect, type Socket } from "socket.io-client";
import type { BidCreatedEvent } from "../../src/realtime/bid-events";

export async function socketClient(url: string, options: object = {}): Promise<Socket> {
  const socket = connect(url, { autoConnect: false, reconnection: false, transports: ["websocket"], timeout: 1500, ...options });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", error => { socket.close(); reject(error); }); socket.connect(); });
  return socket;
}
export function nextBid(socket: Socket): Promise<BidCreatedEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off("bid:created", receive); reject(new Error("Evento de lance não recebido")); }, 1500);
    const receive = (event: BidCreatedEvent) => { clearTimeout(timeout); resolve(event); };
    socket.once("bid:created", receive);
  });
}
