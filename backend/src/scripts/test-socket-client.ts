import { io } from "socket.io-client";
import { validateId } from "../modules/lots/lot.validation";
import type { RoomAck } from "../realtime/bid-socket";
import type { BidCreatedEvent, LotExtendedEvent } from "../realtime/bid-events";

function main(): void {
  const args = process.argv.slice(2);
  let lotId: string;
  try {
    if (args.length !== 1) throw new Error();
    lotId = validateId(args[0]);
  } catch {
    console.error("Uso: npm run socket:client -- UUID_DO_LOTE");
    console.error("Informe exatamente um UUID válido de lote existente.");
    process.exitCode = 1;
    return;
  }

  const socket = io("http://localhost:3000", {
    autoConnect: false,
    path: "/socket.io",
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 5000,
  });
  let stopping = false;
  function stop(): void {
    if (stopping) return;
    stopping = true;
    socket.disconnect();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    console.log("Cliente encerrado.");
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  socket.on("connect", () => {
    console.log("Conectado a http://localhost:3000. Solicitando inscrição...");
    socket.timeout(5000).emit("lot:join", { lotId }, (error: Error | null, result?: RoomAck) => {
      if (stopping) return;
      if (error || !result || !result.ok) {
        console.error(error ? "Inscrição sem resposta em 5 segundos." : result && !result.ok ? `Inscrição recusada: ${result.error.code} — ${result.error.message}` : "Resposta de inscrição inválida.");
        process.exitCode = 1;
        stop();
        return;
      }
      console.log(`Inscrito no lote ${result.lotId}. Aguardando bid:created (Ctrl+C para sair).`);
      console.log("Após reconexão, consulte também o histórico REST para recuperar eventos perdidos.");
    });
  });
  socket.on("bid:created", (event: BidCreatedEvent) => {
    console.log("bid:created", JSON.stringify({ lotId: event.lotId, bidId: event.bidId, amount: event.amount, createdAt: event.createdAt, sequence: event.sequence }, null, 2));
  });
  socket.on("connect_error", () => {
    console.error("Erro de conexão com http://localhost:3000. Verifique se o backend está ativo; serão feitas até 5 tentativas de reconexão.");
  });
  socket.on("lot:extended", (event: LotExtendedEvent) => {
    console.log("lot:extended", JSON.stringify({ lotId: event.lotId, previousEndsAt: event.previousEndsAt, endsAt: event.endsAt, triggerBidId: event.triggerBidId }, null, 2));
  });
  socket.on("disconnect", reason => { if (!stopping) console.log(`Conexão interrompida (${reason}).`); });
  socket.on("lot:closed", event => { console.log("lot:closed", JSON.stringify(event, null, 2)); });
  socket.on("auction:closed", event => { console.log("auction:closed", JSON.stringify(event, null, 2)); });
  socket.io.on("reconnect_failed", () => {
    console.error("Não foi possível reconectar após 5 tentativas.");
    process.exitCode = 1;
    stop();
  });
  socket.connect();
}

main();
