# Anti-sniping por lote

Um lance novo e válido nos últimos dois minutos garante prazo até dois minutos após sua aceitação. A mudança é persistida na mesma transação do lance e das reservas. O encerramento e a captura posteriores são realizados pelo [worker de encerramento](encerramento-liquidacao.md), respeitando o prazo individual.

## Persistência

Migração aditiva autorizada: `20261027000000_lot_ends_at`. Adiciona somente `Lot.endsAt`, opcional, PostgreSQL `TIMESTAMPTZ(3)`:

```prisma
endsAt DateTime? @db.Timestamptz(3)
```

Prazo efetivo = `Lot.endsAt ?? Auction.endsAt`.

`Auction.endsAt` continua como prazo-base. Lotes existentes permanecem com NULL e herdam esse prazo. A primeira prorrogação grava apenas o prazo individual do lote atingido, sem modificar os demais lotes ou o leilão. Não há backfill, exclusão/recriação de tabelas ou atualização dos registros anteriores. A migração usa transação explícita e timeout de bloqueio de 10 segundos.

Foi aplicada localmente por `npm.cmd run prisma:migrate:deploy`, após confirmar que somente essa migração estava pendente; o Client foi regenerado. Não foram usados reset ou db push. Em outros ambientes, confira `npm.cmd run prisma:migrate:status` antes de aplicar pendências e execute `npm.cmd run prisma:generate`.

O cliente não pode escolher/editar `Lot.endsAt`: POST/PATCH de lotes rejeitam o campo. Agendamento/abertura mantêm a herança do prazo-base e recusam um PENDING com prazo individual inesperado, sem sobrescrevê-lo.

## Regra temporal

O instante de aceitação `t` vem de `clock_timestamp()` do PostgreSQL, convertido de epoch em milissegundos, depois dos bloqueios. É o mesmo instante persistido em `Bid.createdAt`. Para prazo efetivo `E`:

```text
Se t >= E: rejeitar o lance.
Se 0 < E - t <= 120000 ms:
    candidato = t + 120000 ms
    gravar somente se candidato > E
Caso contrário: manter o prazo.
```

| Aceitação, para prazo-base 16:20:00 | Resultado |
|---|---|
| 16:17:59.999 | Fora da janela; mantém 16:20:00 |
| 16:18:00.000 | Limite exato; mantém 16:20:00, sem evento de extensão |
| 16:19:00.000 | Prorroga esse lote para 16:21:00 |
| Novo lance às 16:20:10, nesse lote | Prorroga novamente para 16:22:10 |
| Lance às 16:20:10 em outro lote sem prorrogação | Rejeita por prazo expirado |
| Lance exatamente no prazo efetivo | Rejeita; não reabre o lote |

No limite exato de dois minutos o candidato coincide com o prazo existente: já há uma janela completa, sem alteração ou `lot:extended`. Nunca se soma dois minutos ao prazo anterior; nunca se reduz um prazo existente. Prorrogações sucessivas não têm limite de quantidade nesta etapa.

Depois do prazo-base, um lote prorrogado continua aceitando ofertas **somente se Auction e Lot permanecerem OPEN**, o início tiver chegado e o prazo individual ainda não tiver terminado. A validação não mantém um bloqueio adicional pelo término original do leilão, pois isso anularia a prorrogação. Outros estados continuam bloqueados.

## Atomicidade, reservas e idempotência

Mantêm-se Serializable, bloqueios leilão → lote → carteiras em UUID ordenado, sequência dos lances e tentativas limitadas para conflitos. Cada transação relê o prazo sob os mesmos bloqueios que protegem a oferta e a reserva. A fila em memória não substitui as garantias do PostgreSQL entre instâncias.

As validações de valor, incremento, propriedade e saldo disponível são preservadas. Somente um lance válido ajusta reservas/movimentos e atualiza o prazo no mesmo UPDATE que incrementa a versão do lote. Aumento próprio continua reservando apenas a diferença; superar outro participante continua liberando a posição anterior atomicamente.

Falha de gravação ou commit reverte lance, reservas, movimentos, versão e prazo. Rejeição não libera o líder, não prorroga e não emite eventos. Replay idempotente retorna o lance original, mesmo após o prazo, sem recalcular prorrogação, atualizar a posição ou republicar eventos. Mesma chave com outro valor/lote continua retornando 409.

O módulo de lances não liquida reservas: essa responsabilidade é do worker, após o prazo efetivo. A auditoria SHA-256 de abertura não é reescrita; não foi inventada ação de prorrogação no enum de auditoria.

## REST e Socket.IO

URLs existentes preservadas:

- POST `/api/lots/:lotId/bids`: mantém `{ bid, replayed }`, status 201/200 e autenticação BIDDER.
- GET `/api/auctions/:auctionId/lots`: lista pública paginada.
- GET `/api/auctions/:auctionId/lots/:lotId`: detalhe público.

As respostas públicas dos lotes, inclusive criação/edição, acrescentam **`endsAt` em ISO UTC com o prazo efetivo**, nunca NULL. O campo opcional interno não é serializado diretamente. Exemplo de recorte, mantendo os demais campos públicos:

```json
{
  "lot": {
    "id": "11111111-1111-4111-8111-111111111111",
    "endsAt": "2026-10-26T16:21:00.000Z"
  }
}
```

GET do leilão continua exibindo o prazo-base. Para recuperar o prazo atualizado de um lote após reconexão, consulte seu detalhe ou a listagem.

Após commit, na fila por lote desta instância, publica-se `bid:created` e depois `lot:extended` quando houver aumento real. Ambos vão somente à sala `lot:<lotId>`:

```json
{
  "lotId": "11111111-1111-4111-8111-111111111111",
  "previousEndsAt": "2026-10-26T16:20:00.000Z",
  "endsAt": "2026-10-26T16:21:00.000Z",
  "triggerBidId": "22222222-2222-4222-8222-222222222222"
}
```

Eventos não contêm dados privados, não são persistidos ou retransmitidos e podem ser perdidos em queda de processo/conexão. O prazo é persistido no PostgreSQL: **REST é a fonte de verdade**. Falhas de transmissão não revertem lances/prorrogações. A ordem de emissão continua limitada a uma instância; a integridade financeira/temporal é transacional. Veja [socket-io-lances.md](socket-io-lances.md).

## Roteiro de prorrogação real no Postman

Use `baseUrl = http://localhost:3000/api`, tokens `auctioneerToken` e `bidderToken`. Reinicie o backend atualizado depois da migração/geração do Client.

1. Crie um leilão com início aproximadamente um minuto no futuro e término quatro minutos no futuro. Pre-request Script do POST de criação:

```javascript
const now = Date.now();
pm.environment.set("startsAt", new Date(now + 60000).toISOString());
pm.environment.set("endsAt", new Date(now + 240000).toISOString());
```

POST `{{baseUrl}}/auctions`, Bearer AUCTIONEER:

```json
{
  "title": "Teste anti-sniping",
  "startsAt": "{{startsAt}}",
  "endsAt": "{{endsAt}}"
}
```

O relógio do cliente serve apenas para preparar datas; a aceitação usa o banco. Não deixe esse script em outros requests para não sobrescrever as variáveis usadas na comparação.

2. Cadastre dois veículos do organizador e dois lotes nesse leilão, números 1/2, preço `"100.00"` e incremento `"10.00"`. Salve `auctionId`, `lotId` e `otherLotId`.
3. Antes do início, PATCH `{{baseUrl}}/auctions/{{auctionId}}/schedule` sem corpo. Aguarde o início e envie PATCH `.../open`.
4. Prepare saldo suficiente do BIDDER pelo crédito simulado existente, respeitando as restrições de ambiente.
5. GET `{{baseUrl}}/auctions/{{auctionId}}/lots`: guarde o `endsAt` inicial dos dois lotes. Opcionalmente, em dois terminais na pasta backend:

```powershell
npm.cmd run socket:client -- UUID_DO_LOTE_1
```

6. Espere faltar aproximadamente 30–60 segundos para o prazo inicial. POST `{{baseUrl}}/lots/{{lotId}}/bids`, Bearer BIDDER, header `Idempotency-Key: anti-sniping-001`:

```json
{ "amount": "100.00" }
```

7. Espere 201, `bid:created` e `lot:extended`. O prazo novo deve ser `bid.createdAt + 120 segundos`, maior que o anterior. Consulte os dois lotes: somente o lote 1 deve mudar. GET do leilão mantém o prazo-base.
8. Repita chave/valor: 200, `replayed: true`, sem novo evento nem mudança de prazo.
9. Depois do prazo-base, mas antes do prazo individual, ofereça `"110.00"` no lote 1 com chave `anti-sniping-002`: deve ser aceito e pode prorrogar novamente. Uma oferta no lote 2 sem prorrogação deve retornar 409.
10. Confira carteira/histórico: total inalterado e aumento próprio reservando só a diferença. Valor abaixo do incremento, saldo insuficiente ou `endsAt` enviado no POST/PATCH de lote devem ser rejeitados sem mudar o prazo.
11. Pare de enviar ofertas e espere o último prazo efetivo terminar. Novo lance retorna 409 mesmo antes de o worker atualizar o status. Na entrega de encerramento, o worker captura a reserva e finaliza o lote; consulte [encerramento-liquidacao.md](encerramento-liquidacao.md).

No limite exato de dois minutos não há prorrogação real; essa fronteira é coberta por testes determinísticos. O roteiro manual busca uma mudança visível dentro da janela.

## Testes

Na pasta `backend`: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`.

Regressão completa com PostgreSQL real:

```powershell
$env:ANTI_SNIPING_DATABASE_TESTS = '1'
$env:SOCKET_DATABASE_TESTS = '1'
$env:AUCTION_LIFECYCLE_DATABASE_TESTS = '1'
$env:BID_DATABASE_TESTS = '1'
$env:WALLET_DATABASE_TESTS = '1'
$env:LOT_DATABASE_TESTS = '1'
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd run test:integration } finally {
  Remove-Item Env:ANTI_SNIPING_DATABASE_TESTS
  Remove-Item Env:SOCKET_DATABASE_TESTS
  Remove-Item Env:AUCTION_LIFECYCLE_DATABASE_TESTS
  Remove-Item Env:BID_DATABASE_TESTS
  Remove-Item Env:WALLET_DATABASE_TESTS
  Remove-Item Env:LOT_DATABASE_TESTS
  Remove-Item Env:VEHICLE_DATABASE_TESTS
}
```

Os testes de fronteira controlam somente a resposta SQL do relógio, mantendo transações/locks/valores no PostgreSQL real. Há também cenário com relógio real sem injeção. São cobertos prorrogações sucessivas, filas de instâncias independentes, isolamento entre lotes, reservas, prazo-base ultrapassado, rejeições e rollback. Clientes Socket.IO reais conferem ordem, isolamento de salas e ausência de evento/prazo atualizado antes do commit.

As novas integrações usam tabelas descartáveis de prefixo exclusivo reconstruídas a partir das migrações, incluindo a nova. Não modificam registros de uso nem a cadeia de auditoria existente.

Resultado original da entrega de anti-sniping: **422 testes aprovados** (339 sem banco e 83 com PostgreSQL real), incluindo 22 novos cenários. Validação Prisma, typecheck e build aprovados. Migração aplicada e Prisma Client regenerado; registros preexistentes preservados. A regressão posterior de encerramento e liquidação está documentada em [encerramento-liquidacao.md](encerramento-liquidacao.md).
