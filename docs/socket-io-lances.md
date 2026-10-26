# Atualizações de lances com Socket.IO

O Socket.IO transmite eventos públicos de lances. **O registro do lance continua exclusivamente no REST**: `POST /api/lots/:lotId/bids`, com JWT BIDDER, JSON monetário e `Idempotency-Key`. Não há operação financeira por socket.

## Servidor e conexão

Socket.IO 4 está ligado ao mesmo `http.Server` do Express, na porta configurada (padrão 3000). Não há segunda porta ou segundo servidor HTTP. O caminho do protocolo é `/socket.io`; conecte à origem do servidor, sem `/api`.

O acompanhamento é público e não exige JWT. O servidor não lê tokens enviados pelo socket nem os repassa nos eventos. Use um cliente Socket.IO compatível com a versão 4; WebSocket puro não implementa o protocolo Socket.IO.

CORS usa a mesma origem de `FRONTEND_URL` do Express, com padrão `http://localhost:5173`. O handshake também valida Origin para WebSocket, pois apenas o cabeçalho CORS não restringe esse transporte. Clientes nativos, como Node, podem conectar sem Origin. Não foi alterado `.env` ou o frontend.

## Eventos do cliente

### `lot:join`

Payload contendo exatamente um campo:

```json
{ "lotId": "11111111-1111-4111-8111-111111111111" }
```

O servidor valida/normaliza o UUID, verifica se o lote existe e entra na sala `lot:<UUID em minúsculas>`. O cliente não escolhe o nome da sala. Lotes inexistentes não geram inscrição. Repetir join do mesmo lote é idempotente.

### `lot:leave`

Mesmo payload. Sai da sala derivada daquele UUID; repetir leave é idempotente. Não é feita consulta ao banco para sair. Ao desconectar, todas as inscrições são removidas automaticamente.

### Acknowledgements

Ambos aceitam callback opcional. Sucesso:

```json
{ "ok": true, "lotId": "11111111-1111-4111-8111-111111111111" }
```

Erro:

```json
{
  "ok": false,
  "error": { "code": "INVALID_REQUEST", "message": "Envie somente { lotId: UUID válido }." }
}
```

Outros códigos: `NOT_FOUND`, `SUBSCRIPTION_LIMIT`, `RATE_LIMITED`, `INTERNAL_ERROR`. Erros de banco retornam mensagem genérica, sem query ou dados sensíveis. Esses códigos são acknowledgements de socket, não status HTTP.

## Limites por conexão

- Até 20 inscrições simultâneas em lotes.
- Até 30 operações join/leave por janela de 10 segundos, contando payloads inválidos e repetições.
- Até 10 operações pendentes, processadas sequencialmente para impedir corrida no limite de salas.
- Mensagens de entrada limitadas a 1024 bytes pelo transporte.

Sair de uma sala libera uma vaga. Os limites são por conexão; proteção global por IP/proxy não foi adicionada nesta etapa. Nomes de salas, propriedades extras, arrays, IDs malformados e payloads que tentem selecionar uma sala arbitrária são rejeitados.

## Evento do servidor: `bid:created`

Enviado apenas às conexões inscritas no lote correspondente:

```json
{
  "lotId": "11111111-1111-4111-8111-111111111111",
  "bidId": "22222222-2222-4222-8222-222222222222",
  "amount": "150.00",
  "createdAt": "2026-10-26T15:00:00.000Z",
  "sequence": 1
}
```

O valor é string decimal. `sequence` é a sequência pública do lance no lote e permite conferir ordenação e reconciliar lacunas. A projeção é explícita: não inclui usuário, nome, e-mail, carteira, saldo, reservas, chave de idempotência ou token.

O serviço publica somente depois que `repository.place` resolve, portanto **depois do commit PostgreSQL**. Não existe emissão dentro do callback transacional ou das tentativas de repetição. Rollback não emite evento, e resultado `replayed: true` não publica novamente. O repositório e as regras financeiras existentes não foram alterados.

Uma fila em memória serializa registro + publicação por lote nesta instância, evitando que uma resposta de commit mais recente seja transmitida antes da anterior. Lotes diferentes continuam concorrentes e protegidos pelas transações/bloqueios financeiros do banco. A fila aceita até 100 lances pendentes por lote; excesso retorna HTTP 429 e o cliente pode reenviar a mesma chave. Uma falha não bloqueia a fila seguinte.

Falhas de transmissão são isoladas e registradas somente com mensagem genérica. Não revertem o commit, não modificam saldo e não transformam o lance confirmado em erro financeiro. O ACK HTTP pode chegar antes ou depois da notificação de socket por latência de rede; o evento já representa um lance confirmado.

## Teste com dois clientes

O script pronto fica em `backend/src/scripts/test-socket-client.ts`, seguindo a estrutura existente. `socket.io-client` já está instalado como dependência de desenvolvimento. Inicie o backend conectado ao PostgreSQL real e execute, na pasta `backend`, em **dois terminais separados**:

```powershell
npm.cmd run socket:client -- UUID_REAL_DO_LOTE
```

Substitua `UUID_REAL_DO_LOTE` pelo UUID de um lote existente, sem colchetes ou chaves. Exemplo de formato:

```powershell
npm.cmd run socket:client -- 11111111-1111-4111-8111-111111111111
```

O exemplo só será inscrito se esse lote existir no banco. Também é possível executar diretamente:

```powershell
npx.cmd tsx src/scripts/test-socket-client.ts UUID_REAL_DO_LOTE
```

O cliente conecta sempre a `http://localhost:3000`, confirma a inscrição, imprime os eventos `bid:created` e informa falhas de conexão/inscrição. Ctrl+C desconecta e encerra cada instância independentemente. Em caso de reconexão, reinscreve o lote; após cinco tentativas malsucedidas, encerra com erro. UUID inválido, inscrição recusada ou timeout de inscrição também encerram com código de erro. Não lê `.env`, não exige token e não acessa o banco diretamente: quem valida o lote no PostgreSQL é o backend. O script não cria lotes, lances ou créditos.

Com os dois clientes inscritos, envie um lance válido pelo Postman conforme os passos abaixo e confira a notificação nos dois terminais. O lote precisa estar OPEN, em leilão OPEN dentro do período permitido, e o BIDDER precisa ter saldo. Reenviar a mesma chave de idempotência não deve produzir outra notificação.

Como alternativa ao script pronto, é possível usar o cliente interativo abaixo.

Inicie o backend normalmente em um terminal. Em outros dois terminais, abra a pasta `backend`, execute `node` e cole o exemplo abaixo, usando o mesmo UUID de lote existente:

```javascript
const { io } = require("socket.io-client");
const lotId = "UUID_REAL_DO_LOTE";
const socket = io("http://localhost:3000", {
  path: "/socket.io",
  transports: ["websocket"]
});

socket.on("bid:created", event => console.log("Lance confirmado:", event));
socket.on("connect", () => {
  socket.timeout(3000).emit("lot:join", { lotId }, (error, result) => {
    console.log(error ? "Inscrição sem resposta" : result);
  });
});
socket.on("connect_error", () => console.log("Falha de conexão"));
```

O cliente de testes está nas devDependencies. Não informe JWT nesses observadores públicos.

1. Prepare leilão e lote OPEN usando os endpoints de agendamento/abertura já existentes, dentro do período de lances; prepare saldo do BIDDER pelo fluxo de demonstração.
2. No Postman, envie POST `http://localhost:3000/api/lots/UUID_REAL_DO_LOTE/bids`, Bearer BIDDER, header `Idempotency-Key: socket-demo-001`, Body raw JSON:

```json
{ "amount": "150.00" }
```

3. Ajuste o valor ao preço inicial/maior lance e incremento. Ambos os clientes inscritos devem receber o mesmo `bid:created`; o REST retorna 201.
4. Repita o POST com a mesma chave e valor: o REST retorna 200 com `replayed: true`, sem novo evento.
5. No segundo cliente, saia da sala:

```javascript
socket.timeout(3000).emit("lot:leave", { lotId }, console.log);
```

6. Envie novo lance válido com chave nova: somente o primeiro cliente recebe. Inscreva o segundo em outro lote para conferir o isolamento entre salas.
7. Teste `lot:join` com `{ lotId: "invalido" }` ou `{ lotId, room: "private" }`: ACK de erro, sem inscrição.
8. Um lance rejeitado por saldo insuficiente, incremento ou horário não deve gerar evento.

Para encerrar um observador: `socket.disconnect()`. Após reconexão, o callback `connect` reinscreve o lote; também é necessário consultar o REST para recuperar eventos perdidos.

## Ordem, reconexão e limitações

A entrega é **best effort**, sem outbox, persistência de notificações ou confirmação individual do recebimento. A ordem de emissão é preservada nesta instância e o Socket.IO preserva a ordem dos eventos entregues, mas uma queda de conexão/processo pode perder notificações. Veja as [garantias oficiais do Socket.IO](https://socket.io/docs/v4/delivery-guarantees/).

Existe uma janela entre commit e emissão: se o processo cair ali, o lance continua registrado, mas o evento pode não chegar. Reenviar uma chave já confirmada não republica o evento. O histórico REST é a fonte de verdade.

Ao entrar/reconectar, instale o listener, aguarde o ACK do join e consulte `GET /api/lots/:lotId/bids?page=1&limit=20`. Reconcile por `bidId` e `sequence`, descartando duplicatas e recuperando páginas quando necessário. Entrar na sala não transmite um snapshot ou os lances antigos. Enquanto obtém o snapshot, o cliente pode armazenar as notificações recebidas para conciliá-las depois.

Esta implementação é para **uma instância do backend**. Não há adapter compartilhado, fila distribuída ou garantia de ordem entre múltiplos processos/servidores. Todos os lances e assinantes devem chegar à mesma instância para a transmissão funcionar como descrito. Escalar a entrega com garantias maiores exigirá um projeto posterior; nenhuma migração foi criada.

Enviar `bid:created`, `bid:create` ou outro evento pelo cliente não cria nem retransmite lances. Não há Socket.IO para encerramento, liquidação ou anti-sniping.

## Testes

Na pasta `backend`:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Regressão completa com PostgreSQL real, sem modificar `.env`:

```powershell
$env:SOCKET_DATABASE_TESTS = '1'
$env:AUCTION_LIFECYCLE_DATABASE_TESTS = '1'
$env:BID_DATABASE_TESTS = '1'
$env:WALLET_DATABASE_TESTS = '1'
$env:LOT_DATABASE_TESTS = '1'
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd run test:integration } finally {
  Remove-Item Env:SOCKET_DATABASE_TESTS
  Remove-Item Env:AUCTION_LIFECYCLE_DATABASE_TESTS
  Remove-Item Env:BID_DATABASE_TESTS
  Remove-Item Env:WALLET_DATABASE_TESTS
  Remove-Item Env:LOT_DATABASE_TESTS
  Remove-Item Env:VEHICLE_DATABASE_TESTS
}
```

Os testes usam clientes Socket.IO reais, polling/WebSocket, HTTP REST e JWT reais. As integrações financeiras usam tabelas descartáveis com prefixo exclusivo e mantêm uma transação aberta antes do commit para verificar ausência de emissão antecipada. Também forçam rollback após as gravações e conferem ordem, idempotência e ausência de movimentos persistidos. A cadeia e os registros preexistentes não recebem eventos de teste.

Resultado desta entrega: **400 testes aprovados**, sendo 331 sem banco e 69 com PostgreSQL real; typecheck e build aprovados. Foram acrescentados 21 testes (14 de Socket.IO/HTTP, 4 de fila/publicação e 3 com banco). A comparação final das contagens e resumos dos registros confirmou dados preexistentes intactos, sem tabelas descartáveis restantes.
