# Encerramento automático e liquidação

O backend encerra lotes e captura reservas sem chamadas administrativas. Não há repasse ao leiloeiro, taxas, saques, depósitos reais ou integração de pagamentos. Não foi necessário alterar o schema ou criar migrações.

## Worker e prazo

`SettlementWorker` inicia após o HTTP estar disponível, executa um ciclo imediato e recebe um disparo por segundo. Não sobrepõe ciclos. Cada ciclo busca até 25 candidatos e processa cada lote em uma transação própria. O cursor avança mesmo em caso de erro; ao terminar a varredura, retorna ao início. Uma falha individual não bloqueia permanentemente os demais candidatos. O intervalo não garante encerramento em exatamente um segundo: carga, tamanho da fila e bloqueios podem atrasá-lo.

A descoberta inclui lotes OPEN de leilões OPEN e leilões com todos os lotes terminais. Lotes ainda futuros são ignorados na transação. Essa busca deliberadamente não filtra timestamps no SQL: o adaptador instalado normaliza offsets de timestamptz, e foi observada diferença de três horas entre comparação SQL direta e datas vistas pelo Prisma. Para preservar o comportamento dos lances e as datas existentes, ambos usam o prazo lido pelo Prisma e o epoch de `clock_timestamp()` do PostgreSQL. Nenhuma configuração global de fuso ou dado existente foi alterado. Uma correção geral do adaptador/datas precisa de análise separada.

Prazo efetivo: `Lot.endsAt ?? Auction.endsAt`. O worker só finaliza quando o instante do banco é maior ou igual ao prazo efetivo. Lances continuam exigindo instante estritamente anterior. Lote prorrogado permanece aberto após o prazo-base; outros lotes não herdam sua prorrogação. DRAFT, SCHEDULED e CANCELLED não são abertos ou liquidados pelo worker.

No shutdown o worker para de buscar candidatos, limpa o timer e aguarda a transação em andamento antes da desconexão do banco. Ao reiniciar, redescobre os estados persistidos. Queda antes do commit causa rollback pelo PostgreSQL; queda após commit não repete o débito.

## Transações e concorrência

Isolamento Serializable, com até três tentativas para conflitos de serialização/deadlock. Bloqueios: Auction → Lot → carteira vencedora → AuditEvent. O lock do leilão usa `FOR UPDATE SKIP LOCKED`: outro worker ou lance em andamento faz o candidato ser tentado em uma próxima varredura. Nunca se bloqueia um lote antes de seu leilão.

O prazo é relido sob os mesmos bloqueios usados pelos lances. Uma prorrogação confirmada é observada antes de encerrar. O relógio vem do PostgreSQL depois dos bloqueios, sem usar `Date.now()` na decisão. A captura, o resultado, o comprovante, os eventos de auditoria e eventual fechamento do leilão são atômicos.

Múltiplos workers são seguros financeiramente. A comunicação Socket.IO permanece limitada a uma instância, pois o barramento é local ao processo.

## Vencedor e liquidação

O último lance por `sequence` deve coincidir com o maior valor. Não existe novo critério de desempate. A única reserva ACTIVE do lote deve corresponder ao lance, usuário, carteira e valor vencedores. Ausência, divergência, múltiplas reservas ativas, saldo inválido ou resultado parcial bloqueiam o processamento, sem reparação automática.

Para venda:

1. Conferir saldo total e soma de todas as reservas ACTIVE da carteira, inclusive de outros lotes.
2. Subtrair o valor vencedor de `Wallet.balance`, sem saldo negativo e sem consumir a cobertura das outras reservas.
3. Alterar a reserva vencedora de ACTIVE para CAPTURED. Não criar RELEASE adicional.
4. Registrar DEBIT positivo com `balanceAfter` atualizado, vínculo da reserva e chave única `settlement:{lotId}`.
5. Marcar lote SOLD, preencher winnerId internamente e incrementar versões de lote/carteira.
6. Emitir AuctionReceipt com o lance, vencedor, valor final e snapshots descritivos.
7. Anexar auditoria na mesma transação.

Todos os cálculos usam Prisma.Decimal. Reservas já RELEASED e movimentações anteriores são preservadas. Reservas ACTIVE de outros lotes permanecem intactas.

Exemplo: total 500.00, reservado 100.00 e disponível 400.00 tornam-se total 400.00, reservado 0.00 e disponível 400.00. Uma segunda reserva de 80.00 manteria o disponível em 320.00 antes e depois da captura.

Sem lances nem reservas, o lote fica UNSOLD, sem vencedor, débito ou comprovante. Reserva sem lance é inconsistência. CANCELLED é terminal, mas não pode conter resultado financeiro incompatível.

O leilão passa de OPEN para CLOSED somente quando todos os seus lotes estão SOLD, UNSOLD ou CANCELLED e seus resultados são consistentes. OPEN prorrogado ou PENDING impede o fechamento. Há recuperação de leilões OPEN cujos lotes já estejam todos finalizados; não há fechamento de leilão vazio.

Logs de falha usam somente código operacional e UUIDs de lote/leilão, sem mensagens brutas do driver, saldos, nomes, e-mails, tokens ou URL de banco. O lote permanece sem alterações quando uma transação falha. `SETTLEMENT_INCONSISTENT` indica falha de consistência/auditoria; `SETTLEMENT_FAILED`, falha operacional. Investigue a causa antes de qualquer correção administrativa.

## Comprovante autenticado

`GET /api/lots/:lotId/receipt`

Header: `Authorization: Bearer <token>`.

Apenas o vencedor ou o leiloeiro responsável pelo leilão podem consultar. Ser AUCTIONEER de outro leilão não concede acesso. Não há consulta pública por publicId nem endpoint para criar/alterar/forçar comprovante ou liquidação. Resposta com `Cache-Control: no-store`:

```json
{
  "receipt": {
    "publicId": "UUID_DO_COMPROVANTE",
    "lotId": "UUID_DO_LOTE",
    "winningBidId": "UUID_DO_LANCE",
    "finalAmount": "100.00",
    "issuedAt": "2026-10-26T16:22:00.000Z",
    "auctionTitle": "Teste encerramento",
    "lotNumber": 1,
    "vehicleBrand": "Marca",
    "vehicleModel": "Modelo",
    "vehicleYear": 2020,
    "vehicleVersion": null
  }
}
```

HTTP 400: UUID ou query inválida; 401: JWT ausente/inválido; 403: sem vínculo autorizado; 404: lote inexistente ou comprovante não disponível para o responsável. UNSOLD não gera comprovante. Não são retornados winnerId, carteira, saldo ou dados pessoais.

## Resultado público e eventos

GET `/api/auctions/:auctionId/lots` e GET `/api/auctions/:auctionId/lots/:lotId` preservam os campos existentes, inclusive endsAt efetivo, e acrescentam `result`:

```json
{ "status": "SOLD", "winningBidId": "UUID_DO_LANCE", "finalAmount": "100.00" }
```

Para UNSOLD: `{ "status": "UNSOLD", "winningBidId": null, "finalAmount": null }`. Para demais estados: `result: null`. winnerId nunca é exposto.

Após commit, são emitidos `lot:closed` na sala do lote e, quando for o último lote, `auction:closed` na união das salas dos lotes do leilão. Um cliente inscrito em duas dessas salas recebe uma única notificação do leilão. Payloads e exemplos estão em [socket-io-lances.md](socket-io-lances.md).

Os eventos não são persistidos nem garantidos. Queda após commit e antes da emissão pode perder a notificação; não causa novo débito ao reiniciar. Falhas de listeners/transmissão não revertem dinheiro confirmado. Após reconexão, consulte REST de lote, leilão, carteira, histórico e comprovante. closedAt é o instante público do processamento, não altera o prazo endsAt e não constitui novo campo do schema.

## Auditoria

O mesmo gravador e verificador aceitam aberturas e encerramentos na cadeia global. Mantêm-se a serialização original, os hashes antigos, o lock de tabela e a verificação integral. Eventos automáticos têm authorId nulo. Para cada lote são anexados LOT_CLOSED e, em venda, FUNDS_DEBITED e RECEIPT_ISSUED. O último lote acrescenta AUCTION_CLOSED. Dados financeiros privados permanecem nas tabelas financeiras, fora de publicData. Ver [auditoria-abertura.md](auditoria-abertura.md).

## Roteiro manual: Postman, PostgreSQL e dois clientes

1. Inicie o PostgreSQL e o backend atualizado com `npm.cmd run dev` na pasta backend. Não é necessária migração. O worker passa a processar também lotes OPEN existentes e vencidos; utilize dados de demonstração. Não execute UPDATE manual de status ou saldo.
2. No Postman defina `baseUrl=http://localhost:3000/api`, `auctioneerToken`, `bidderToken` e um token de outro participante. Use tokens já obtidos pelo login e veículos pertencentes ao leiloeiro.
3. Crie leilão POST `{{baseUrl}}/auctions` com Bearer AUCTIONEER. Antes desta requisição, execute:

```javascript
const now = Date.now();
pm.environment.set("startsAt", new Date(now + 60000).toISOString());
pm.environment.set("endsAt", new Date(now + 240000).toISOString());
```

```json
{ "title": "Teste encerramento", "startsAt": "{{startsAt}}", "endsAt": "{{endsAt}}" }
```

Salve auctionId. Não repita o script em outras requisições.

4. Crie dois lotes POST `{{baseUrl}}/auctions/{{auctionId}}/lots`, Bearer AUCTIONEER, com veículos diferentes. Salve lotId e otherLotId:

```json
{ "vehicleId": "{{vehicleId}}", "number": 1, "startingPrice": "100.00", "minimumIncrement": "10.00" }
```

Para o segundo use outro vehicleId e number 2.

5. Antes do início, PATCH `{{baseUrl}}/auctions/{{auctionId}}/schedule`, sem corpo. Após o início, PATCH `.../open`, também sem corpo. Ambos com Bearer AUCTIONEER.
6. Com BIDDER, consulte GET `{{baseUrl}}/wallet`. Se necessário, no ambiente local de demonstração já habilitado, POST `{{baseUrl}}/wallet/credit`, headers Authorization, Content-Type application/json e Idempotency-Key `manual-credit-close-001`, JSON `{ "amount": "500.00" }`. Créditos são simulados; as restrições existentes permanecem.
7. Em dois terminais distintos, pasta backend, execute em ambos:

```powershell
npm.cmd run socket:client -- UUID_DO_LOTE_1
```

8. Espere faltar entre 30 e 60 segundos para o prazo-base. POST `{{baseUrl}}/lots/{{lotId}}/bids`, Bearer BIDDER, Content-Type application/json, Idempotency-Key `manual-close-bid-001`, JSON `{ "amount": "100.00" }`. Espere 201, bid:created e lot:extended em ambos os terminais. Guarde o endsAt efetivo do GET do lote 1.
9. Não dê lances no lote 2. Após o prazo-base, ele deve ficar UNSOLD. O lote 1 deve continuar OPEN até o seu prazo prorrogado, e o leilão também deve continuar OPEN. Consulte ambos pelo REST.
10. Pare de dar lances e aguarde o prazo individual e a passagem do worker. Os dois clientes devem receber lot:closed SOLD e depois auction:closed CLOSED. O lote 1 deve ter resultado público com finalAmount 100.00; o lote 2 continua UNSOLD, e o leilão fica CLOSED.
11. GET wallet deve mostrar total anterior menos 100.00, reservado do lote zerado e disponível preservado. GET `/wallet/transactions?page=1&limit=20` deve conter exatamente um DEBIT de 100.00 para a liquidação, sem RELEASE da reserva capturada.
12. GET `{{baseUrl}}/lots/{{lotId}}/receipt` deve retornar o mesmo comprovante ao vencedor e ao leiloeiro. Outro participante/leiloeiro recebe 403; sem JWT, 401. Lote UNSOLD retorna 404 ao responsável.
13. Reenvie o lance com a mesma chave/valor: replay 200, sem novos eventos ou débito. Nova chave após o término retorna 409. Reinicie o backend e confira que comprovante, saldo e quantidade de débitos permanecem iguais; o worker não republica resultados antigos.
14. Desconecte/reconecte um cliente e confirme o resultado pelo REST. Eventos perdidos não são retransmitidos.

Inspeção opcional somente leitura no PostgreSQL, usando o UUID do lote de teste:

```sql
SELECT "id", "status", "endsAt" FROM "Lot" WHERE "id" = 'UUID_DO_LOTE';
SELECT "status", "amount" FROM "BidReservation" WHERE "lotId" = 'UUID_DO_LOTE';
SELECT "type", "amount", "balanceAfter" FROM "WalletTransaction"
WHERE "idempotencyKey" = 'settlement:UUID_DO_LOTE';
SELECT "publicId", "lotId", "winningBidId", "finalAmount" FROM "AuctionReceipt"
WHERE "lotId" = 'UUID_DO_LOTE';
SELECT "sequence", "action", "previousHash", "currentHash" FROM "AuditEvent" ORDER BY "sequence";
```

Não publique resultados financeiros ou identificadores privados de consultas administrativas. A cadeia é verificada pelo gravador antes de cada append; não altere eventos para testar adulteração em dados reais.

## Testes automatizados

Na pasta backend:

```powershell
npm.cmd run prisma:validate
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Regressão com PostgreSQL real (flags somente neste processo PowerShell):

```powershell
$env:SETTLEMENT_DATABASE_TESTS = '1'
$env:ANTI_SNIPING_DATABASE_TESTS = '1'
$env:SOCKET_DATABASE_TESTS = '1'
$env:AUCTION_LIFECYCLE_DATABASE_TESTS = '1'
$env:BID_DATABASE_TESTS = '1'
$env:WALLET_DATABASE_TESTS = '1'
$env:LOT_DATABASE_TESTS = '1'
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd run test:integration } finally {
  'SETTLEMENT_DATABASE_TESTS','ANTI_SNIPING_DATABASE_TESTS','SOCKET_DATABASE_TESTS',
  'AUCTION_LIFECYCLE_DATABASE_TESTS','BID_DATABASE_TESTS','WALLET_DATABASE_TESTS',
  'LOT_DATABASE_TESTS','VEHICLE_DATABASE_TESTS' | ForEach-Object { Remove-Item "Env:$_" }
}
```

As novas integrações usam PostgreSQL real com tabelas exclusivas de fixture, removidas ao final, sem modificar registros de uso ou sua cadeia. Há clocks controlados somente para fronteiras exatas, além do worker com relógio real. São testados captura, reservas concorrentes, dois workers, repetição, reinício, rollback, integridade da auditoria, JWT e entrega Socket.IO após commit.

Resultado desta entrega: **463 testes aprovados**, 356 sem banco e 107 com PostgreSQL real; 41 novos cenários. Prisma validate, typecheck e build aprovados. Contagens e hashes dos registros de todas as dez tabelas de negócio permaneceram iguais após a regressão. Nenhuma migração foi criada ou executada.

## Limitações

Sem distribuição de eventos entre instâncias, outbox, ancoragem externa de hashes ou métricas persistentes de falhas. Diagnósticos precisam de acompanhamento operacional. O custo da auditoria cresce com a cadeia; a descoberta percorre os lotes OPEN em páginas, inclusive futuros. Não há SLA de encerramento em um segundo. Um PENDING inesperado ou dado financeiro inconsistente mantém o leilão aberto até investigação. Nenhuma reparação automática, repasse ou pagamento real foi implementado.
