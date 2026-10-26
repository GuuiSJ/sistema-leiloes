# Cadastro e gerenciamento de veículos

## Propriedade e migração

Cadastro manual, listagem, consulta, edição e exclusão estão disponíveis. O backend associa cada novo veículo ao leiloeiro autenticado em `Vehicle.ownerId`; o cliente não escolhe nem altera essa propriedade.

A inspeção somente leitura do PostgreSQL em 26/10/2026 encontrou **0 veículos, 0 lotes e 1 AUCTIONEER**. Foram conferidas as colunas e as FKs de `Vehicle`, `User` e `Lot`. `Lot.vehicleId`, `Lot.auctionId` e `Lot.winnerId` têm exclusão restritiva. As unicidades por leilão/número e leilão/veículo e os vínculos a lances, reservas e recibos foram preservados. `Auction.organizerId` continua indicando somente o organizador do leilão.

A migração `20261026120000_vehicle_owner`, autorizada para esta funcionalidade, adiciona apenas `ownerId UUID NOT NULL`, índice e FK para `User` com `ON DELETE RESTRICT`. Não define valor padrão nem executa UPDATE/DELETE de dados. Foi aplicada com sucesso no banco local. A relação inversa é `User.vehicles`.

A migração abre uma transação, bloqueia a tabela e verifica novamente se existem veículos antes de adicionar a coluna. Se houver qualquer veículo, **interrompe e faz rollback**, exigindo uma decisão aprovada de mapeamento; nunca atribui automaticamente ao único leiloeiro existente. Isso protege também a execução em outros ambientes e a criação de registros entre inspeção e migração. O bloqueio tem timeout de 10 segundos.

Em um ambiente com registros preexistentes, pare antes de executar essa migração e solicite aprovação para um mapeamento explícito por veículo ou uma migração em etapas com proprietário temporariamente nulo e escrita bloqueada para legados. Não usar reset, excluir veículos ou escolher um proprietário por conveniência. Se uma tentativa falhar pela pré-condição, a recuperação do histórico de migração também deve ser revisada antes de tentar novamente.

Para uma instalação vazia, após configurar a conexão existente, execute na pasta `backend`: `npm.cmd run prisma:migrate:status`, `npm.cmd run prisma:migrate:deploy` e `npm.cmd run prisma:generate`. Não use `db push` ou reset para contornar a pré-condição. Clientes antigos devem ser interrompidos durante a atualização: o novo proprietário obrigatório não aceita cadastros do código anterior.

## Endpoints

| Método | Endpoint | Acesso e resultado |
|---|---|---|
| POST | `/api/vehicles` | JWT e AUCTIONEER; 201 `{ "vehicle": ... }` |
| GET | `/api/vehicles` | Público; 200 com `data` e `pagination` |
| GET | `/api/vehicles/:id` | Público; 200 `{ "vehicle": ... }` |
| PATCH | `/api/vehicles/:id` | JWT e AUCTIONEER proprietário; 200 `{ "vehicle": ... }` quando não houver impedimentos |
| DELETE | `/api/vehicles/:id` | JWT e AUCTIONEER proprietário; sem corpo; 204 sem conteúdo quando não houver vínculos |

Erros: 400 para payload, query ou UUID inválidos; 401 para JWT ausente/inválido ou usuário inexistente; 403 para perfil incompatível ou outro proprietário; 404 para veículo inexistente; 409 para lotes, histórico ou conflito de concorrência; 500 genérico para falhas internas. Autenticação e perfil são verificados antes dos dados nas operações de escrita. O middleware consulta o perfil atual do usuário no banco.

## Regras de edição e exclusão

- Somente o proprietário pode editar ou excluir. O identificador dele vem exclusivamente do usuário autenticado e não aparece nas respostas públicas.
- Edição é permitida sem lotes ou quando **todos** os lotes são PENDING, sem vencedor, lances, reservas ou recibos, em leilões DRAFT/SCHEDULED com início e término ainda futuros.
- Edição é bloqueada com 409 para lotes OPEN/SOLD/UNSOLD/CANCELLED, leilões OPEN/CLOSED/CANCELLED ou com início atingido, qualquer histórico de lance/reserva/recibo, vencedor ou auditoria relacionada ao veículo ou seus lotes. O bloqueio de auditoria é conservador e preserva a descrição vinculada ao histórico.
- Exclusão é bloqueada com 409 por **qualquer lote**, inclusive pendente/cancelado, ou auditoria que referencie o veículo. Não há exclusão em cascata. Lances, reservas, recibos, transações financeiras e auditoria não são apagados ou alterados.

Autorização, leitura das dependências e gravação compartilham uma transação Serializable. O repositório bloqueia o veículo, os leilões relacionados e os lotes antes da decisão; conflitos de serialização são repetidos até três tentativas e depois retornam 409. Violações de FK também retornam 409.

`AuditEvent` usa referência genérica sem FK. A consulta de histórico verifica `entityId` do veículo e dos lotes, sem depender da grafia de `entityType`. Futuras operações que gravem auditoria para veículos devem coordenar o bloqueio do mesmo veículo para evitar referências concorrentes após exclusão; não existe endpoint de gravação dessa auditoria nesta etapa. Não foi implementada API de lotes ou lances.

## Campos e validações

- `brand` e `model`: obrigatórios, texto não vazio, até 100 e 150 caracteres.
- `year`: obrigatório, inteiro de 1886 até o ano atual em UTC + 1.
- `imageUrls`: obrigatório, array de até 20 URLs HTTP(S), até 2048 caracteres cada, sem credenciais. Aceita `[]`; não faz download das imagens.
- `version`: opcional/nulo, até 150 caracteres.
- `description`: opcional/nulo conforme schema, até 10000 caracteres; quando informada como texto, não pode ser vazia.
- `fipeCode`, `fipeBrandCode`, `fipeModelCode`, `fipeYearCode`: opcionais/nulos, texto de até 30 caracteres.
- `fipeReferenceMonth`: opcional/nulo, texto de até 50 caracteres.
- `fipeReferencePrice`: opcional/nulo, **string decimal não negativa**, até 16 dígitos inteiros e duas casas decimais, por exemplo `"45000.00"`. Não aceita número JSON, notação exponencial ou vírgula.

Textos são aparados e não aceitam caractere nulo. Campos desconhecidos são rejeitados, incluindo `id`, `ownerId`, `owner`, `userId`, `organizerId`, `createdAt`, `updatedAt`, `lots`, `fipeConsultedAt` e `fipeReferencePriceVerified`. PATCH aceita somente os campos editáveis acima, todos opcionais, exigindo ao menos um campo. O proprietário é imutável nesses endpoints.

Não existe chamada obrigatória à BrasilAPI. Dados FIPE enviados pelo cliente são referências declaradas, **não verificadas** e não definem preço de venda. O cadastro sempre grava `fipeConsultedAt: null`; as respostas retornam `fipeReferencePriceVerified: false`. A presença de códigos ou mês de referência não comprova consulta ao provedor. Preços são serializados como string com duas casas decimais, sem conversão para ponto flutuante.

As respostas selecionam explicitamente campos públicos do veículo, sem incluir lotes, organizadores, usuários ou dados financeiros.

## Postman

Crie as variáveis `baseUrl` (por exemplo, `http://localhost:3000/api`, ajustando à porta configurada), `auctioneerToken`, `bidderToken` e `vehicleId`. Inicie o backend com `cd backend` e `npm.cmd run dev`. Obtenha os tokens pelo login já existente; use um usuário AUCTIONEER previamente provisionado. O cadastro público de usuário não concede esse perfil.

### Cadastro manual

POST `{{baseUrl}}/vehicles`, Authorization → Bearer Token → `{{auctioneerToken}}`, Body → raw → JSON:

```json
{
  "brand": "Fiat",
  "model": "Uno",
  "year": 2020,
  "version": "1.0",
  "description": "Veículo conservado, com marcas de uso.",
  "imageUrls": ["https://example.com/uno.jpg"]
}
```

Espere 201 e salve `vehicle.id` em `vehicleId`. Script opcional da aba Tests/Post-response:

```javascript
pm.test("Cadastro criado", () => pm.response.to.have.status(201));
pm.environment.set("vehicleId", pm.response.json().vehicle.id);
```

Para testar referências FIPE opcionais, acrescente ao mesmo JSON:

```json
{
  "fipeCode": "001001-1",
  "fipeBrandCode": "21",
  "fipeModelCode": "123",
  "fipeYearCode": "2020-1",
  "fipeReferenceMonth": "outubro/2026",
  "fipeReferencePrice": "45000.00"
}
```

Os códigos acima são exemplos de formato, sem garantia de correspondência. Espere `fipeConsultedAt: null` e `fipeReferencePriceVerified: false`, mesmo com esses campos.

### Consultas públicas

GET `{{baseUrl}}/vehicles?page=1&limit=20&brand=fiat&model=uno&year=2020`, sem autenticação. Marca/modelo usam correspondência parcial sem diferenciar maiúsculas; ano usa igualdade. Filtros combinam com AND. Padrões: página 1 e limite 20; máximo de página 1000000 e limite 100. Queries desconhecidas, duplicadas ou inválidas retornam 400.

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Acima, exemplo sem correspondências. Ordenação: criação decrescente e UUID decrescente para desempate. Contagem e página são lidas em transação RepeatableRead.

GET `{{baseUrl}}/vehicles/{{vehicleId}}`, sem autenticação, retorna o veículo cadastrado. UUID malformado retorna 400; UUID válido inexistente retorna 404.

### Edição e exclusão pelo proprietário

PATCH `{{baseUrl}}/vehicles/{{vehicleId}}`, com Bearer `{{auctioneerToken}}`:

```json
{ "description": "Descrição revisada" }
```

Use o token do mesmo AUCTIONEER que fez o cadastro. Sem impedimentos, espere 200 com a descrição revisada. Confirme com GET. Usar o token de outro AUCTIONEER deve retornar 403, mantendo os dados.

DELETE na mesma URL, com o token do proprietário e **sem corpo**, retorna 204 sem conteúdo se não houver lotes ou auditoria; uma consulta posterior retorna 404. Com outro AUCTIONEER, retorna 403. Com qualquer lote ou histórico relevante, retorna 409. Não há endpoint para criar esses vínculos nesta etapa; os testes automatizados usam fixtures isoladas para verificar as proteções.

### Casos negativos

Repita POST/PATCH/DELETE sem token: 401; com `{{bidderToken}}`: 403. No cadastro, teste `year: 1800`, URL `javascript:alert(1)`, marca vazia ou campo extra `ownerId`: 400. Tente enviar `fipeConsultedAt`: 400. PATCH vazio, com `id`, `ownerId` ou `owner` retorna 400 para AUCTIONEER autenticado. DELETE com corpo retorna 400. Consulte um UUID inexistente: 404.

## Testes automatizados

Na pasta `backend`:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

`npm` também pode ser usado onde a política do shell permitir. A suíte HTTP usa JWT real, middleware existente e repositório em memória, sem BrasilAPI ou banco. Cobre propriedade automática, edição/exclusão pelo dono, proibição a outro leiloeiro, campos protegidos, dados públicos, filtros e todos os impedimentos de edição/exclusão.

Há também testes opcionais com PostgreSQL real em `tests/vehicles.database.test.ts`. Aplique a migração antes de executá-los. No PowerShell, habilite-os somente para o processo de teste:

```powershell
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd test } finally { Remove-Item Env:VEHICLE_DATABASE_TESTS }
```

Esses testes exercitam o repositório real, FKs, filtros e proteções de lote/lance/auditoria. Cada cenário cria suas próprias fixtures dentro de uma transação Serializable e força rollback ao final, inclusive em caso de falha, sem alterar veículos existentes ou `.env`. O adaptador de teste reutiliza a transação externa para permitir rollback; esses testes não simulam disputas reais entre conexões concorrentes. A execução padrão deixa essa suíte desabilitada para não depender de PostgreSQL disponível.

Verificação desta entrega: **133 testes aprovados** com integração habilitada (126 sem banco e 7 com PostgreSQL), typecheck e build aprovados. Os testes do repositório verificam repetição limitada de conflitos e conversão de erros de FK em 409. A verificação final confirmou zero veículos, zero lotes e nenhuma fixture de usuário persistida após os rollbacks.
