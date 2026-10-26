# Cadastro e gerenciamento de lotes

## Modelagem utilizada

Implementação na branch `feat/cadastro-lotes`, sem alteração do schema ou migrações. Foram conferidos `Lot`, `Auction`, `Vehicle`, `User`, `Bid`, `BidReservation`, `AuctionReceipt` e `AuditEvent`.

`Lot` contém `auctionId`, `vehicleId`, `number`, `startingPrice`, **`minimumIncrement` obrigatório**, `status`, `winnerId`, `version` e timestamps. Os dois valores monetários são Decimal(18,2). O incremento é exigido no cadastro conforme decisão aprovada; não há incremento financeiro implícito. Nesta etapa, ele não é editável.

O banco impõe unicidades de `(auctionId, number)` e `(auctionId, vehicleId)`. As relações com leilão, veículo, vencedor, lances, reservas e recibos usam exclusão restritiva. O proprietário do leilão é `Auction.organizerId`; o proprietário do veículo é `Vehicle.ownerId`.

## Endpoints

| Método | Endpoint | Sucesso |
|---|---|---|
| POST | `/api/auctions/:auctionId/lots` | 201 `{ "lot": ... }` |
| GET | `/api/auctions/:auctionId/lots` | 200 `{ "data": [...], "pagination": ... }` |
| GET | `/api/auctions/:auctionId/lots/:lotId` | 200 `{ "lot": ... }` |
| PATCH | `/api/auctions/:auctionId/lots/:lotId` | 200 `{ "lot": ... }` |
| DELETE | `/api/auctions/:auctionId/lots/:lotId` | 204, sem corpo |

Consultas são públicas. Escritas exigem Bearer JWT, perfil atual AUCTIONEER, propriedade do leilão e propriedade do veículo. A autenticação reutiliza os middlewares existentes e consulta o perfil atual no banco.

O lote precisa pertencer ao `auctionId` da URL, inclusive nas consultas. Uma combinação de lote/leilão incorreta retorna 404 e não altera nenhum registro.

## Validações

Cadastro exige exatamente os quatro campos:

- `vehicleId`: UUID do veículo existente, pertencente ao mesmo leiloeiro organizador.
- `number`: número JSON inteiro positivo até 2147483647, compatível com Int do PostgreSQL.
- `startingPrice`: string decimal positiva, até 16 dígitos inteiros e duas casas decimais.
- `minimumIncrement`: string decimal positiva, com os mesmos limites.

Exemplos monetários válidos: `"0.01"`, `"100"`, `"15000.50"`. Valores são persistidos como Decimal e retornados como strings com duas casas, sem cálculos com ponto flutuante. Números JSON, zero, negativos, vírgula, notação exponencial, espaços, zeros à esquerda ou mais de duas casas são rejeitados. O preço FIPE não define o preço inicial e não há consulta à BrasilAPI.

PATCH aceita somente `vehicleId`, `number` e `startingPrice`, exigindo ao menos um campo. Trocar o veículo revalida propriedade e duplicidade. `minimumIncrement` é fixado no cadastro nesta etapa.

Campos desconhecidos são rejeitados: por exemplo, `id`, `auctionId`, `ownerId`, `organizerId`, `winnerId`, `status`, `version`, timestamps ou relações Prisma. DELETE não aceita corpo.

Paginação: `page` padrão 1, máximo 1000000; `limit` padrão 20, máximo 100. Ambos devem ser strings de inteiros positivos na query. Parâmetros extras ou duplicados são rejeitados. A ordenação é por número crescente, com UUID como desempate. Página e contagem compartilham uma transação RepeatableRead. Leilão inexistente retorna 404; leilão existente sem lotes retorna lista vazia e `totalPages: 0`.

## Regras de negócio e consistência

- Criação somente em leilão DRAFT com início e término ainda futuros. O status inicial é sempre PENDING.
- Edição e exclusão exigem leilão DRAFT ainda não iniciado e lote PENDING sem vencedor.
- Edição verifica a propriedade do veículo atual e do novo veículo. Exclusão também verifica a propriedade do veículo associado.
- Qualquer lance, reserva (inclusive liberada/capturada), recibo ou auditoria diretamente referenciada ao lote bloqueia edição/exclusão com 409. A verificação conservadora de auditoria usa `entityId`, independentemente de `entityType`.
- Não há exclusão em cascata. Excluir um lote não exclui veículo ou leilão e nunca apaga lances, dados financeiros, recibos ou auditoria.
- O mesmo número e veículo podem aparecer em leilões diferentes do mesmo dono; duplicidade dentro do mesmo leilão retorna 409, inclusive em PATCH.

As escritas usam transações Serializable. A ordem de bloqueio é veículos (UUIDs ordenados para veículo atual/novo), leilão e lote, compatível com o gerenciamento de veículos. O estado e a propriedade são relidos sob a transação antes de gravar. FKs e índices únicos preservam integridade; conflitos de serialização/deadlock são repetidos até três tentativas e depois retornam 409. O tratamento inclui os códigos SQLSTATE dentro de `driverAdapterError` do adapter-pg do Prisma 7. Atualizações incrementam `Lot.version` internamente.

`AuditEvent` é uma referência genérica, sem FK para lote. Futuras gravações de auditoria devem coordenar o mesmo bloqueio do lote e validar sua existência para evitar referências concorrentes após exclusão. Os endpoints desta etapa não implementam lances, carteira ou emissão de recibos.

As respostas selecionam explicitamente dados públicos: IDs públicos do lote/leilão/veículo, número, preços, status, timestamps e dados públicos do veículo. Não incluem proprietário, organizador, e-mail, hash de senha, vencedor, versão interna, reservas ou transações.

## Erros esperados

| HTTP | Situação |
|---|---|
| 400 | JSON, UUID, campos, preço, incremento, número ou paginação inválidos |
| 401 | Token ausente/inválido/expirado ou usuário inexistente |
| 403 | BIDDER, outro organizador ou veículo de outro proprietário |
| 404 | Leilão/veículo/lote inexistente ou lote fora do leilão informado |
| 409 | Duplicidade, estado incompatível, histórico ou conflito concorrente |
| 500 | Falha interna inesperada, com mensagem genérica |

Os erros usam `{ "message": "..." }`. Autenticação e perfil são verificados antes da validação de dados nas escritas.

## Postman

Configure `baseUrl` (por exemplo, `http://localhost:3000/api`, ajustando à porta configurada), `auctioneerToken`, `otherAuctioneerToken`, `bidderToken`, `auctionId`, `vehicleId`, `secondVehicleId` e `lotId`. Use um leilão DRAFT com datas futuras e veículos cadastrados pelo mesmo AUCTIONEER. Tokens vêm do login já existente; o cadastro público de usuário não concede AUCTIONEER.

### Criar

POST `{{baseUrl}}/auctions/{{auctionId}}/lots`, Authorization → Bearer Token → `{{auctioneerToken}}`, Body → raw → JSON:

```json
{
  "vehicleId": "{{vehicleId}}",
  "number": 1,
  "startingPrice": "45000.00",
  "minimumIncrement": "500.00"
}
```

Espere 201. Salve o identificador no script Post-response/Tests:

```javascript
pm.test("Lote criado", () => pm.response.to.have.status(201));
pm.environment.set("lotId", pm.response.json().lot.id);
```

Exemplo de resposta (IDs e datas ilustrativos):

```json
{
  "lot": {
    "id": "11111111-1111-4111-8111-111111111111",
    "auctionId": "22222222-2222-4222-8222-222222222222",
    "vehicleId": "33333333-3333-4333-8333-333333333333",
    "number": 1,
    "startingPrice": "45000.00",
    "minimumIncrement": "500.00",
    "status": "PENDING",
    "createdAt": "2026-10-26T15:00:00.000Z",
    "updatedAt": "2026-10-26T15:00:00.000Z",
    "vehicle": {
      "id": "33333333-3333-4333-8333-333333333333",
      "brand": "Fiat",
      "model": "Uno",
      "year": 2020,
      "version": null,
      "description": null,
      "imageUrls": [],
      "fipeCode": null,
      "fipeBrandCode": null,
      "fipeModelCode": null,
      "fipeYearCode": null,
      "fipeReferenceMonth": null,
      "fipeReferencePrice": null,
      "fipeConsultedAt": null,
      "fipeReferencePriceVerified": false,
      "createdAt": "2026-10-26T14:00:00.000Z",
      "updatedAt": "2026-10-26T14:00:00.000Z"
    }
  }
}
```

### Consultar publicamente

GET `{{baseUrl}}/auctions/{{auctionId}}/lots?page=1&limit=20`, sem token. A resposta contém `data` com os lotes e:

```json
{ "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
```

Esse objeto fica em `pagination`. GET `{{baseUrl}}/auctions/{{auctionId}}/lots/{{lotId}}` retorna `{ "lot": ... }`. Trocar `auctionId` por outro leilão ao consultar o mesmo lote retorna 404.

### Atualizar

PATCH `{{baseUrl}}/auctions/{{auctionId}}/lots/{{lotId}}`, com o token do proprietário:

```json
{
  "number": 2,
  "startingPrice": "47000.00",
  "vehicleId": "{{secondVehicleId}}"
}
```

Todos os campos são opcionais, mas ao menos um é obrigatório. O segundo veículo deve pertencer ao mesmo leiloeiro e ainda não constar desse leilão. Espere 200, com incremento e status preservados. Confirme os dados usando GET.

### Excluir

DELETE na mesma URL, com token do proprietário e **sem corpo**. Espere 204 e consulta posterior 404. Veículo e leilão continuam existentes.

### Casos negativos

Repita escritas sem token (401), com BIDDER (403), com outro leiloeiro (403) e com veículo de outro dono (403). Repita o POST original antes de excluir (409 por duplicidade). Teste `startingPrice: 45000`, `"0"`, `"1.001"`, incremento ausente ou `number: 0` (400). Tente enviar `status`, `ownerId` ou `id` (400). Leilão SCHEDULED/OPEN/CLOSED/CANCELLED ou DRAFT já iniciado bloqueia escritas com 409. Histórico relevante bloqueia PATCH/DELETE com 409; os testes usam fixtures para esses vínculos, sem implementar endpoints de lances ou carteira.

## Testes

Na pasta `backend`, sem dependência de banco:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Integração de lotes e regressão de veículos com PostgreSQL real, usando a conexão já configurada, sem editar `.env`:

```powershell
$env:LOT_DATABASE_TESTS = '1'
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd run test:integration } finally {
  Remove-Item Env:LOT_DATABASE_TESTS
  Remove-Item Env:VEHICLE_DATABASE_TESTS
}
```

`test:integration` executa todos os arquivos sequencialmente para que as fixtures Serializables com rollback dos módulos não disputem o banco entre si. Os testes de concorrência continuam abrindo transações simultâneas dentro dos próprios cenários. As flags de integração são opt-in; evite habilitá-las com o comando padrão paralelo `npm test`.

`lots.test.ts` usa HTTP e JWT reais com persistência em memória. `lot-repository.test.ts` verifica conflitos e repetição limitada. `lots.database.test.ts` usa repositório real, savepoints e rollback integral de fixtures, inclusive históricos financeiros de teste. `lots.concurrency.test.ts` usa transações/conexões concorrentes reais: as fixtures próprias precisam estar temporariamente confirmadas e são removidas em `finally`, exclusivamente por seus UUIDs aleatórios. Se o processo for encerrado antes do `finally`, eventuais fixtures próprias terão e-mails `@example.invalid` e exigirão inspeção manual. Nenhum registro preexistente é escolhido para limpeza e nenhum histórico financeiro é criado pela suíte concorrente.

Nenhuma alteração de schema ou migração foi necessária.

## Verificação desta entrega

Foram aprovados **202 testes** com ambas as flags de integração habilitadas: 184 sem banco e 18 com PostgreSQL (7 da regressão de veículos e 11 de lotes, incluindo 4 cenários concorrentes). O comando padrão também passou com 184 testes, assim como typecheck e build. A conferência final manteve os dados iniciais do banco: 2 usuários, 1 leilão e nenhum veículo, lote, lance, reserva, recibo, evento de auditoria ou transação financeira; nenhuma fixture de usuário permaneceu persistida.

A única alteração no comportamento anterior foi corrigir a identificação de conflitos de serialização/deadlock do adapter-pg no repositório de veículos, necessária para a concorrência entre exclusão de veículo e criação de lote. O mapeamento público de veículo foi exportado para reutilizar a seleção segura de campos.
