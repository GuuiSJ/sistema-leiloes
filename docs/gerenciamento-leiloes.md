# API de gerenciamento de leilões

Gerenciamento do leilão e suas transições controladas, integrado aos lotes e aos
lances existentes, sem alteração do schema Prisma ou criação de migrações.

## Endpoints

| Método e rota | Acesso | Resultado |
| --- | --- | --- |
| `POST /api/auctions` | `AUCTIONEER` autenticado | HTTP 201 com `{ "auction": ... }`, em `DRAFT`, vinculado ao usuário atual. |
| `GET /api/auctions` | Público | HTTP 200 com `data` e `pagination`. |
| `GET /api/auctions/:id` | Público | HTTP 200 com `{ "auction": ... }`. |
| `PATCH /api/auctions/:id` | `AUCTIONEER` responsável | HTTP 200 com o leilão atualizado, somente em `DRAFT` e antes do início. |
| `PATCH /api/auctions/:id/cancel` | `AUCTIONEER` responsável | HTTP 200 com o leilão em `CANCELLED`, sem exclusão física. |
| `PATCH /api/auctions/:id/schedule` | `AUCTIONEER` responsável | HTTP 200 com transição `DRAFT → SCHEDULED`, datas futuras e lotes válidos. |
| `PATCH /api/auctions/:id/open` | `AUCTIONEER` responsável | HTTP 200 com transição `SCHEDULED → OPEN` e abertura atômica dos lotes elegíveis. |

As respostas incluem somente `id`, `title`, `description`, `startsAt`, `endsAt`,
`status`, `createdAt` e `updatedAt`. Não incluem `organizerId`, nome, e-mail,
hash de senha ou relações do organizador. Consulta pública inclui todos os estados,
inclusive `DRAFT` e `CANCELLED`, conforme o escopo desta etapa.

## Validação e autorização

- O JWT é verificado pelos middlewares existentes. O perfil atual é consultado
  no banco em cada requisição autenticada; um papel informado no token não concede acesso.
- Título é obrigatório, aparado e limitado a 150 caracteres. Descrição é opcional,
  aparada, limitada a 10000 caracteres e aceita `null` para remoção.
- Datas usam ISO 8601 com segundos e fuso (`Z` ou offset), com até três casas de
  milissegundos. Datas de calendário inexistentes e valores sem fuso são rejeitados.
- O término deve ser estritamente posterior ao início. No PATCH, a validação
  considera os valores persistidos dos campos omitidos.
- A criação exige período válido, mas não impõe início futuro. Um `DRAFT` cujo
  horário de início já chegou fica bloqueado para edição e cancelamento, mesmo
  sem mudança automática de status. A edição não pode mover o início para o passado.
- PATCH deve conter ao menos um dos campos `title`, `description`, `startsAt` ou
  `endsAt`. Campos extras são rejeitados. `organizerId` e `status` são sempre
  controlados pelo servidor, inclusive no cadastro.
- Cancelamento aceita body ausente ou `{}`. Nenhum campo de alteração é permitido.
- IDs devem ter formato UUID. UUID inválido retorna 400; inexistente retorna 404.
- Sem token válido: 401. Perfil não permitido ou outro responsável: 403.
  Estado/horário incompatível ou operações impeditivas: 409. Dados inválidos: 400.
  Erros internos continuam com mensagem genérica, sem dados sensíveis.

## Paginação e filtros

Exemplo: `GET /api/auctions?page=1&limit=20&status=DRAFT`.

`page` vai de 1 a 1000000, com padrão 1; `limit` vai de 1 a 100, com padrão 20.
`status` é opcional e aceita `DRAFT`, `SCHEDULED`, `OPEN`, `CLOSED`, `CANCELLED`.
Parâmetros desconhecidos, repetidos, vazios ou inválidos retornam 400.

A ordenação é `createdAt DESC, id DESC`. A listagem e o total são lidos no mesmo
snapshot (`RepeatableRead`). A resposta contém:

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

## Cancelamento e concorrência

Somente `DRAFT` ou `SCHEDULED` ainda não iniciados podem ser cancelados. A regra
é conservadora: qualquer lance, reserva (inclusive liberada/capturada), comprovante
ou lote fora de `PENDING`/`CANCELLED` impede o cancelamento. Transações financeiras
vinculadas a reservas desses lotes também ficam protegidas por esse bloqueio.
Transações sem vínculo com o leilão não podem ser atribuídas a ele pelo schema atual.

O cancelamento altera somente `Auction.status`; não altera ou exclui lotes, não
libera reservas e não realiza estornos. Esses fluxos não foram implementados.

Edição e cancelamento usam uma transação `Serializable`, bloqueio da linha de
`Auction` com SQL parametrizado `FOR UPDATE` e validação do estado dentro da mesma
transação. Conflitos Prisma `P2034` têm até três tentativas totais; ao esgotá-las,
retornam 409. Não há nova coluna de versão ou alteração do schema.

Quando forem implementadas operações de lotes e lances, elas deverão participar
do mesmo protocolo de bloqueio/validação do leilão. Esta etapa não garante a
segurança de futuras operações que gravem dados ignorando esse protocolo.

O ponto central para futuras transições e auditoria é o serviço de leilões e sua
mutação transacional. Nenhum agendamento automático, publicação, encerramento,
evento de auditoria ou emissão Socket.IO foi implementado.

## Postman e leiloeiro de teste

Configure `baseUrl=http://localhost:3000`. As variáveis JWT são as mesmas da
autenticação; nenhuma configuração nova de ambiente é necessária.

O cadastro público continua permitindo somente `BIDDER`. Para teste manual,
use uma conta local já existente. Na pasta `backend`, execute em terminal interativo:

```powershell
npm.cmd run user:promote -- "email-do-usuario@example.com"
```

Substitua o argumento pelo e-mail da conta correta. O script normaliza o e-mail,
consulta apenas o ID e o perfil usando Prisma e solicita a confirmação exata
`PROMOVER` antes de gravar. Qualquer outra resposta cancela. Não existe opção
`--yes`, confirmação por pipe ou criação automática de conta.

Requisitos: `NODE_ENV=development` e `DATABASE_URL` apontando para o banco
`sistema_leiloes` em `localhost`, `127.0.0.1` ou `::1`. O script usa o carregamento
existente de `backend/.env`; variáveis do processo continuam tendo prioridade.
Outros ambientes e destinos são bloqueados antes da consulta.

A alteração usa SQL parametrizado via Prisma e modifica literalmente somente
`role`, preservando inclusive `updatedAt`. O UPDATE verifica ID, e-mail e perfil
`BIDDER` para detectar mudanças ocorridas durante a confirmação. Usuário inexistente
não é criado; usuário já `AUCTIONEER` não é alterado. A conexão é encerrada ao final,
e erros internos não exibem credenciais, senhas, hashes ou tokens.

O comando não foi executado automaticamente. Não há endpoint HTTP de promoção.
Depois de executá-lo e confirmá-lo localmente, faça login em `POST /api/auth/login`
com as credenciais existentes da conta e guarde o
`accessToken` em variável privada do Postman. Nas escritas, use Authorization →
Bearer Token → `{{accessToken}}` e Body → raw → JSON.

Para verificar o perfil, faça `GET {{baseUrl}}/api/auth/me` com esse Bearer Token:
o retorno deve conter `user.role: "AUCTIONEER"`. O login também retorna o perfil
atual. Não tente verificar o papel decodificando o JWT: ele não contém o perfil,
e a autorização consulta o usuário no banco a cada requisição.

Criar: `POST {{baseUrl}}/api/auctions`:

```json
{
  "title": "Leilão de veículos",
  "description": "Edição de teste local",
  "startsAt": "2099-11-01T09:00:00-03:00",
  "endsAt": "2099-11-01T18:00:00-03:00"
}
```

Datas são ilustrativas; use o período pretendido. Guarde `auction.id` como `auctionId`.

Listar sem autenticação: `GET {{baseUrl}}/api/auctions?page=1&limit=10&status=DRAFT`.

Consultar sem autenticação: `GET {{baseUrl}}/api/auctions/{{auctionId}}`.

Editar com token do responsável: `PATCH {{baseUrl}}/api/auctions/{{auctionId}}`:

```json
{ "title": "Título atualizado", "description": null }
```

Cancelar com o mesmo token: `PATCH {{baseUrl}}/api/auctions/{{auctionId}}/cancel`,
sem body ou com `{}`. Confira `CANCELLED` na consulta pública. Uma segunda
tentativa de cancelamento retorna 409.

## Testes e decisões

`npm test` executa as suítes sem dependência de PostgreSQL; `npm run typecheck`
inclui os testes; `npm run build` compila o backend sem testes.

Testes HTTP de leilões usam JWT e middlewares reais, com repositórios em memória e
usuários controlados `AUCTIONEER`/`BIDDER` somente no processo de teste. Não criam
contas, leilões, lotes ou operações financeiras reais no banco. O teste de estado
alterado antes da mutação é uma simulação, não um teste de concorrência PostgreSQL.

Não há alteração que exija aprovação de schema ou migração. Decisões adotadas:
consulta pública também para rascunhos/cancelados; bloqueio temporal mesmo em
rascunho; limites de descrição/paginação; bloqueio conservador de qualquer histórico
de reserva ou lance. Relaxar essas regras exigirá definição posterior dos fluxos
financeiros, sem avanço automático nesta entrega.

## Agendamento e abertura sob demanda

A estratégia adotada é **abertura sob demanda pelo responsável autenticado**, usando o endpoint de abertura. Não há scheduler, mudança por consulta pública, abertura disparada por BIDDER ou SQL manual. Agendar não abre antecipadamente e não garante execução automática no horário: depois do início, o responsável chama o endpoint. O processo pode reiniciar sem perder o agendamento, pois o status está no banco. Se ninguém solicitar a abertura durante o período, o leilão permanece SCHEDULED e não aceita lances.

### Agendar

PATCH `{{baseUrl}}/api/auctions/{{auctionId}}/schedule`, com o token AUCTIONEER do organizador, sem corpo ou com `{}`:

- Somente DRAFT pode passar a SCHEDULED.
- O início deve ser estritamente futuro e o término posterior ao início, conforme relógio do PostgreSQL.
- É necessário ao menos um lote não cancelado. Todos os não cancelados devem ser PENDING, com número positivo, preço inicial/incremento positivos, veículo do mesmo responsável, sem vencedor, lances, reservas ou recibos.
- Lotes CANCELLED são preservados e ignorados; qualquer outro lote incompatível bloqueia a transição inteira com 409.
- O endpoint não recebe nem altera datas. Ajuste-as pelo PATCH existente enquanto o leilão ainda estiver em DRAFT.
- SCHEDULED já agendado retorna sucesso sem alterar datas, lotes ou auditoria (`unchanged: true`). OPEN/CLOSED/CANCELLED não podem ser agendados por esse endpoint.

### Abrir

PATCH `{{baseUrl}}/api/auctions/{{auctionId}}/open`, com o mesmo token, sem corpo ou com `{}`:

- Somente SCHEDULED passa a OPEN; não existe atalho DRAFT → OPEN.
- Exige `startsAt <= agora < endsAt`. O início é inclusivo; o término, exclusivo.
- Revalida propriedade e condições dos lotes. Todos os PENDING elegíveis passam a OPEN na mesma transação que o leilão; as versões dos lotes são incrementadas.
- Lotes CANCELLED continuam cancelados. Incompatibilidade em qualquer outro lote impede toda a abertura.
- Reenvio para leilão já OPEN retorna `unchanged: true`, sem reabrir lotes, incrementar versões ou duplicar eventos. Esse reenvio não é uma nova abertura e não altera status mesmo após o término.
- Leilões CLOSED/CANCELLED não são reabertos. Abertura antes do início ou no/após término retorna 409.

As duas operações rejeitam campos extras, inclusive `status`, `organizerId`, `startsAt` e `force`; queries também são rejeitadas. JWT ausente/inválido retorna 401; BIDDER ou outro leiloeiro, 403; UUID inválido, 400; inexistente, 404; estado, horário, dados de lote ou cadeia incompatíveis, 409.

Exemplo de resposta após abrir dois lotes:

```json
{
  "auction": {
    "id": "11111111-1111-4111-8111-111111111111",
    "title": "Leilão de demonstração",
    "description": null,
    "startsAt": "2026-10-26T15:00:00.000Z",
    "endsAt": "2026-10-26T16:00:00.000Z",
    "status": "OPEN",
    "createdAt": "2026-10-26T14:00:00.000Z",
    "updatedAt": "2026-10-26T15:00:00.000Z"
  },
  "openedLots": 2,
  "unchanged": false
}
```

### Atomicidade, horário e auditoria

As transições usam Serializable e bloqueiam veículos em ordem de UUID, leilão e lotes. Essa ordem é compatível com edição de veículos/lotes e com lances. As condições são relidas dentro da transação; mudanças concorrentes ou conflitos persistentes retornam 409, com até três tentativas para serialização/deadlock.

A abertura adquire também o bloqueio global da auditoria. O relógio do banco é consultado novamente depois dessa espera: uma operação que começou antes do término não pode abrir depois dele. O epoch é convertido para `Date` para evitar a diferença de fuso observada na conversão de timestamps brutos do driver.

O gravador mínimo da cadeia foi explicitamente autorizado nesta etapa. A abertura grava um AUCTION_OPENED e um LOT_OPENED por lote aberto, na **mesma transação** dos status. Erro em qualquer evento reverte leilão, lotes e todos os eventos desse lote de gravações. Não altera carteira, saldo, lance, reserva ou histórico financeiro.

O formato versionado, a canonicalização, os campos públicos permitidos e os limites de proteção estão em [auditoria-abertura.md](auditoria-abertura.md). Cadeia existente inválida ou de formato não suportado bloqueia novas aberturas; não há reparo automático. Agendamento não grava evento de abertura.

### Fluxo completo no Postman

Neste documento `baseUrl` é a origem do servidor, por exemplo `http://localhost:3000`, sem `/api`.

1. Com AUCTIONEER, crie um leilão com início alguns minutos no futuro e término posterior. Use ISO 8601 com segundos e fuso, ajustados ao momento do teste.
2. Cadastre um veículo com o mesmo usuário e crie ao menos um lote nesse leilão, enquanto ele estiver DRAFT.
3. PATCH `{{baseUrl}}/api/auctions/{{auctionId}}/schedule`, Bearer do organizador, sem corpo. Confira SCHEDULED.
4. Antes do início, PATCH `.../open` retorna 409 e não abre lotes.
5. Aguarde o início e envie PATCH `.../open` antes do término. Confira OPEN e `openedLots`.
6. Consulte os lotes publicamente: os elegíveis estarão OPEN.
7. Faça login com outro usuário BIDDER, consulte/credite sua própria carteira pelo fluxo de demonstração e envie POST `{{baseUrl}}/api/lots/{{lotId}}/bids`, header `Idempotency-Key: lance-001`, JSON `{"amount":"100.00"}`, ajustando ao preço inicial.

Não é necessário alterar o banco manualmente. As restrições de crédito simulado permanecem vigentes. Não foram implementados encerramento ou liquidação: o módulo de lances recusa ofertas no/após término mesmo se o status continuar OPEN.

### Testes das transições com PostgreSQL

```powershell
$env:AUCTION_LIFECYCLE_DATABASE_TESTS = '1'
$env:BID_DATABASE_TESTS = '1'
$env:WALLET_DATABASE_TESTS = '1'
$env:LOT_DATABASE_TESTS = '1'
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd run test:integration } finally {
  Remove-Item Env:AUCTION_LIFECYCLE_DATABASE_TESTS
  Remove-Item Env:BID_DATABASE_TESTS
  Remove-Item Env:WALLET_DATABASE_TESTS
  Remove-Item Env:LOT_DATABASE_TESTS
  Remove-Item Env:VEHICLE_DATABASE_TESTS
}
```

Na pasta `backend`, `npm.cmd test`, `npm.cmd run typecheck` e `npm.cmd run build` continuam disponíveis. Os testes novos de banco usam tabelas e enums descartáveis com prefixo aleatório `lc_<UUID>_`, reconstruídos a partir das migrações existentes. Um adaptador exclusivo dos testes direciona tanto as consultas Prisma quanto os bloqueios SQL a essas tabelas. Isso preserva as FKs reais e permite concorrência entre conexões sem inserir/remover eventos na cadeia de auditoria de uso. A conta de teste precisa poder criar tabelas/types no schema public; não precisa criar schemas ou ter credenciais administrativas. O `finally` remove apenas os objetos com o prefixo gerado pela própria execução. Não há alteração de `schema.prisma`, de migrações ou de permissões. Interrupção forçada pode deixar objetos de teste para inspeção manual.

Resultado desta entrega: **379 testes aprovados**, sendo 313 sem banco e 66 com PostgreSQL real; typecheck e build aprovados. As transições e a auditoria acrescentaram 45 testes, incluindo 11 com banco. A comparação final confirmou os registros preexistentes intactos e nenhum objeto descartável restante.
