# Lances e reservas financeiras

Implementação na branch `feat/sistema-lances`, sem alteração de schema ou migração. A abertura controlada foi adicionada ao módulo de leilões; Socket.IO, encerramento automático e liquidação permanecem fora do escopo.

## Análise do schema e rastreabilidade

Foram inspecionados `Bid`, `BidReservation`, `Wallet`, `WalletTransaction`, `Lot` e `Auction`, seus índices e relações:

- `Bid` preserva cada oferta, com `userId`, `lotId`, `amount`, `sequence` e `createdAt`. `(lotId, sequence)` é único. Os índices permitem ordenar ofertas por valor e sequência.
- `BidReservation` representa uma **posição por carteira/lote**, garantida por `(walletId, lotId)` único. `bidId` é único; FKs compostas conferem carteira/usuário e lance/lote/usuário. A posição é atualizada, sem excluir e recriar seu histórico.
- Quando o mesmo participante aumenta seu lance, a posição mantém o ID e passa a apontar para o novo `Bid`; seu valor reservado é atualizado. Se ele havia sido superado, a posição RELEASED é reativada. CAPTURED não pode ser reativada por este módulo.
- `WalletTransaction` preserva cada CREDIT/RESERVE/RELEASE/DEBIT, com valor positivo, saldo total após a movimentação, chave de idempotência única e referência opcional à posição. Somente RESERVE e RELEASE são criados por lances.
- Como a posição muda de `bidId`, a referência à reserva sozinha não identifica todos os lances históricos. Por isso, as novas chaves internas de movimentação incluem IDs **imutáveis** dos lances correspondentes. Os lances e movimentos anteriores nunca são atualizados ou apagados pelos endpoints.
- `Wallet.balance` representa saldo total. Reservado = soma das posições ACTIVE; disponível = total menos reservado. Reservar/liberar não altera `balance`, e `WalletTransaction.balanceAfter` continua sendo o **saldo total**, não o disponível.
- `Lot` possui preço inicial, incremento mínimo, status, vencedor e versão; `Auction` possui status, organizador, início e término. Todos os valores monetários envolvidos usam Decimal(18,2).

A unicidade existente de reserva permite o ajuste seguro da posição sob bloqueio e transação, sem migração. A rastreabilidade usa os registros imutáveis de `Bid` e `WalletTransaction`, além da posição corrente.

## Endpoints

| Método | Endpoint | Acesso | Sucesso |
|---|---|---|---|
| POST | `/api/lots/:lotId/bids` | JWT e BIDDER | 201 novo lance; 200 reenvio idempotente |
| GET | `/api/lots/:lotId/bids` | Público | 200, lista paginada |

### Registrar lance

Header obrigatório: `Idempotency-Key`, de 1 a 64 caracteres ASCII entre letras, números, ponto, hífen, dois-pontos e sublinhado. Corpo contendo somente:

```json
{ "amount": "150.50" }
```

`amount` deve ser string decimal positiva, de `"0.01"` a `"9999999999999999.99"`, com no máximo duas casas decimais. Aceita `"150"` ou `"150.5"`; retorna `"150.50"`. Não aceita número JSON, zero, negativos, vírgula, notação exponencial, espaços, zeros inteiros à esquerda ou precisão excessiva.

`userId`, `walletId`, `lotId`, `reservationId`, `sequence`, `status`, IDs internos ou quaisquer campos extras no corpo são rejeitados. O lote vem da URL e o participante exclusivamente da autenticação. Query string não é aceita no POST.

Exemplo de resposta:

```json
{
  "bid": {
    "id": "11111111-1111-4111-8111-111111111111",
    "lotId": "22222222-2222-4222-8222-222222222222",
    "amount": "150.50",
    "sequence": 1,
    "createdAt": "2026-10-26T15:00:00.000Z"
  },
  "replayed": false
}
```

### Consultar ofertas

GET `/api/lots/:lotId/bids?page=1&limit=20`, sem token. Ordenação por sequência decrescente (mais recente primeiro). Padrões: página 1 e limite 20; máximos: página 1000000 e limite 100. Parâmetros desconhecidos ou duplicados são rejeitados.

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Cada item usa os mesmos campos públicos de `bid` no exemplo acima. Não são retornados usuário, nome, e-mail, carteira, reserva ou chave de idempotência. Lote existente sem lances retorna lista vazia; lote inexistente retorna 404. Página e contagem são lidas em uma transação RepeatableRead.

## Regras de aceitação

Um novo lance exige simultaneamente:

- Usuário autenticado com perfil atual BIDDER, conforme middleware existente.
- Leilão OPEN e lote OPEN, sem vencedor ou recibo de arrematação.
- Horário de aceitação `startsAt <= agora < endsAt`, usando o relógio do PostgreSQL depois de adquirir os bloqueios. O epoch evita diferenças de conversão de fuso do driver. Status OPEN fora do período não permite lance.
- Participante diferente do organizador do leilão e do proprietário do veículo, mesmo que um perfil tenha sido alterado administrativamente.
- Primeiro lance maior ou igual ao preço inicial. Depois, valor maior ou igual ao maior lance aceito mais o incremento mínimo. Não se exige múltiplo exato do incremento.
- Carteira existente e saldo disponível suficiente. Consulte a carteira e obtenha crédito simulado pelo módulo já existente antes do lance. Este endpoint não cria dinheiro nem concede crédito.

Não há abertura automática. O responsável autenticado agenda com `PATCH /api/auctions/:id/schedule` enquanto o início ainda é futuro e abre sob demanda com `PATCH /api/auctions/:id/open` depois do início e antes do término. A abertura muda o leilão e todos os lotes elegíveis para OPEN atomicamente, com auditoria encadeada. Veja [gerenciamento-leiloes.md](gerenciamento-leiloes.md) e [auditoria-abertura.md](auditoria-abertura.md). Não é necessário alterar status por SQL para testar lances.

## Reserva, liberação e aumento próprio

Exemplo: saldo total de A e B igual a `"500.00"`, preço inicial `"100.00"`, incremento `"10.00"`:

| Operação | Reservado de A | Reservado de B | Histórico novo |
|---|---:|---:|---|
| A oferece 100 | 100 | 0 | RESERVE 100 para A |
| A aumenta para 110 | 110 | 0 | RESERVE 10 para A |
| B oferece 120 | 0 | 120 | RELEASE 110 para A; RESERVE 120 para B |
| A oferece 130 | 130 | 0 | RELEASE 120 para B; RESERVE 130 para A |

Os saldos totais permanecem 500; somente o reservado e o disponível mudam. A posição de A é reutilizada, mantendo seu ID; todos os quatro lances e seus movimentos continuam registrados.

Para aumento próprio, a necessidade adicional é `novo valor - valor já reservado nesta posição`. Essa diferença deve caber no disponível da carteira, que já desconta reservas de **todos** os lotes. Se outro participante liderava, é necessário reservar o valor integral; a reserva anterior só é liberada se toda a nova operação puder ser concluída.

Estados inconsistentes, como maior lance sem reserva correspondente, mais de uma reserva ACTIVE para o lote, posição CAPTURED, saldo total negativo, reserva ACTIVE não positiva ou soma reservada superior ao total, bloqueiam novos lances com 409. O endpoint não corrige históricos arbitrariamente.

## Concorrência e atomicidade

Cada novo lance executa em uma transação Serializable. A ordem de bloqueio é:

1. Leilão.
2. Lote.
3. Carteiras do participante e do maior ofertante, em ordem de UUID.

Essa ordem é compatível com os módulos anteriores: veículos/lotes bloqueiam veículo antes de leilão/lote, e a carteira isolada não tenta bloquear leilões. Ordenar as carteiras evita ciclos nas trocas cruzadas de liderança entre leilões diferentes. Leilões compartilhados são serializados de forma conservadora.

Sob os bloqueios, o estado é relido, o maior lance é conferido, o saldo global reservado é calculado com `Prisma.Decimal` e a sequência é atribuída como anterior + 1. As versões do lote e das carteiras cujas reservas mudam são incrementadas internamente, mesmo sem alterar saldo total.

Lance, atualização/reativação da posição, liberação anterior e todos os movimentos são confirmados juntos. Falha de qualquer gravação faz rollback integral. Os índices únicos e as FKs continuam ativos. Não há exclusões nem alterações de lances ou movimentos históricos.

Conflitos de serialização/deadlock são repetidos até três tentativas, incluindo os códigos retornados pelo adapter-pg do Prisma 7. Persistindo o conflito, retorna 409; o cliente deve reenviar a **mesma chave**. Não há cálculo monetário em ponto flutuante. A conversão numérica usada para construir `Date` trata apenas milissegundos do relógio, sem relação com dinheiro.

## Idempotência e identificação histórica

A chave textual é escopada pelo usuário e pela operação, não por lote. O servidor calcula SHA-256 de `userId + separador + chave` e persiste:

- RESERVE: `bid:<hash da requisição>:<UUID do lance original>` (105 caracteres).
- RELEASE: `bid-release:<UUID do lance liberado>:<UUID do novo lance>` (85 caracteres).

Ambos cabem em `WalletTransaction.idempotencyKey` (120). As chaves são internas e não são retornadas pelas consultas públicas de lances ou pelo histórico da carteira.

O prefixo da requisição é consultado **sob o bloqueio da carteira**. Toda aceitação altera sua versão, e o isolamento Serializable exige repetição se outra transação tiver modificado a mesma carteira. Assim, duas requisições com a mesma chave, inclusive em lotes diferentes, não podem registrar duas intenções. O índice único continua protegendo a chave completa de cada movimento; a exclusividade do prefixo é garantida pelo protocolo transacional.

- Mesmo usuário, chave, lote e valor decimal: 200, mesmo ID e `replayed: true`, sem nova reserva, movimento ou mudança de versão.
- Mesma chave com outro lote ou valor: 409.
- Usuários diferentes podem usar a mesma chave textual.
- Nova chave é uma nova intenção e precisa respeitar o incremento e o saldo.
- Reenvio de lance já aceito continua retornando o original após a liberação, reativação da posição ou fechamento do leilão. Não reabre o lote nem altera finanças. Ainda exige JWT e perfil BIDDER atuais.

Não se deve interpretar o `bidId` atual da reserva como referência de todos os movimentos antigos. Para rastrear um movimento deste módulo, use seu UUID de lance incorporado na chave interna e o registro imutável de `Bid`. A reserva representa a posição atual; os movimentos representam os eventos históricos.

## Postman

Configure `baseUrl` (por exemplo `http://localhost:3000/api`, ajustando à porta), `lotId` de um lote OPEN em leilão OPEN no período, `bidderAToken`, `bidderBToken` e chaves fixas por intenção.

Preparação com o token AUCTIONEER do organizador: crie leilão com início alguns minutos no futuro, cadastre seu veículo e o lote, envie PATCH `{{baseUrl}}/auctions/{{auctionId}}/schedule` sem corpo, aguarde o início e envie PATCH `{{baseUrl}}/auctions/{{auctionId}}/open` sem corpo. O endpoint de abertura exige o responsável, recusa BIDDER e abre todos os PENDING válidos na mesma transação, preservando CANCELLED. Só depois use os tokens BIDDER nos passos abaixo. `baseUrl` neste documento já inclui `/api`.

1. Com A, GET `{{baseUrl}}/wallet` e obtenha saldo pelo crédito **simulado** já existente; repita para B. As restrições de demonstração de crédito permanecem vigentes, conforme `carteira-virtual.md`.
2. POST `{{baseUrl}}/lots/{{lotId}}/bids`, Bearer A, header `Idempotency-Key: lance-a-001`, corpo `{"amount":"100.00"}`. Ajuste o valor ao preço inicial do lote. Espere 201.
3. Repita exatamente a intenção com a mesma chave: 200 e mesmo ID. Mude somente o valor mantendo a chave: 409.
4. Com B, chave `lance-b-001`, ofereça o maior valor + incremento mínimo. Espere 201; a carteira de A passa a ter sua reserva liberada e B mantém a nova reserva.
5. Com B, nova chave `lance-b-002`, aumente o próprio lance. Somente a diferença adicional é reservada.
6. GET `{{baseUrl}}/wallet` e GET `{{baseUrl}}/wallet/transactions` com cada token: confira RESERVE/RELEASE, sem alteração indevida do total. O `balanceAfter` de cada movimento é o total histórico.
7. GET `{{baseUrl}}/lots/{{lotId}}/bids?page=1&limit=20`, sem token: confira valores e sequência, sem identidade dos participantes.

POST com raw JSON:

```json
{ "amount": "110.00" }
```

Script Post-response para o primeiro envio:

```javascript
pm.test("Lance registrado", () => pm.response.to.have.status(201));
pm.environment.set("bidId", pm.response.json().bid.id);
```

Não gere nova chave automaticamente durante testes de reenvio. Lances abaixo do mínimo ou sem fundos retornam 409 e não modificam o líder anterior. Sem JWT retorna 401; AUCTIONEER retorna 403. IDs financeiros no corpo ou valor numérico retornam 400. Um lote PENDING ou leilão fora do horário retorna 409.

## Testes

Na pasta `backend`:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Regressão completa com PostgreSQL real, usando a conexão existente sem alterar `.env`:

```powershell
$env:BID_DATABASE_TESTS = '1'
$env:AUCTION_LIFECYCLE_DATABASE_TESTS = '1'
$env:WALLET_DATABASE_TESTS = '1'
$env:LOT_DATABASE_TESTS = '1'
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd run test:integration } finally {
  Remove-Item Env:BID_DATABASE_TESTS
  Remove-Item Env:AUCTION_LIFECYCLE_DATABASE_TESTS
  Remove-Item Env:WALLET_DATABASE_TESTS
  Remove-Item Env:LOT_DATABASE_TESTS
  Remove-Item Env:VEHICLE_DATABASE_TESTS
}
```

Os arquivos são executados em sequência para evitar interferência entre fixtures Serializables; os cenários de concorrência abrem transações simultâneas reais dentro de cada teste.

- `bids.test.ts`: HTTP e JWT reais, validações, permissões, status, horários, idempotência e privacidade.
- `bid-repository.test.ts`: conflitos, limites de repetição e mensagens seguras.
- `bids.database.test.ts`: reservas, liberação, aumento próprio, reativação, histórico imutável, falha financeira com rollback e rejeição de inconsistências.
- `bids.concurrency.test.ts`: participantes simultâneos, mesma chave, mesma carteira em lotes distintos, chave reutilizada entre lotes, trocas cruzadas, crédito simultâneo e bloqueio que ultrapassa o horário de término.
- `tests/helpers/bid-fixture.ts`: somente fixtures próprias. Testes transacionais usam savepoints e rollback integral; testes com múltiplas conexões precisam de fixtures temporariamente confirmadas e removem exclusivamente os UUIDs gerados por eles em `finally`, incluindo seus movimentos financeiros de teste. Não selecionam contas ou dados preexistentes para limpeza. Interrupção forçada pode deixar fixtures identificáveis por `@example.invalid` para inspeção manual.

## Escopo e pendências

Não há migração pendente. Os registros financeiros preexistentes são preservados. A abertura é feita pelos endpoints controlados de leilões; esta etapa não encerra ou liquida lotes. Após o término, novos lances são bloqueados pelo horário, mas as reservas existentes permanecem até a implementação explícita de encerramento/liberação/liquidação; nenhum dinheiro é debitado automaticamente.

## Resultado da validação

**379 testes aprovados** na regressão completa após adicionar as transições de abertura: 313 sem banco e 66 com PostgreSQL real. O módulo de lances mantém 68 testes: 35 HTTP, 8 de conflitos, 17 transacionais e 8 de concorrência real. Typecheck e build aprovados.

A inspeção final comparou contagens e resumos dos registros com a leitura anterior aos testes: usuários, leilões, veículos, lotes e todas as tabelas financeiras permaneceram iguais, incluindo a carteira e o crédito preexistentes. Nenhuma fixture de lance, reserva ou movimentação ficou persistida.
