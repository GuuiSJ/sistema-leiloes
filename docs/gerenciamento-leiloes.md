# API de gerenciamento de leilões

Implementação limitada ao modelo `Auction`, sem alterações de schema, migrações,
dependências adicionais ou APIs de veículos, lotes, lances e carteiras.

## Endpoints

| Método e rota | Acesso | Resultado |
| --- | --- | --- |
| `POST /api/auctions` | `AUCTIONEER` autenticado | HTTP 201 com `{ "auction": ... }`, em `DRAFT`, vinculado ao usuário atual. |
| `GET /api/auctions` | Público | HTTP 200 com `data` e `pagination`. |
| `GET /api/auctions/:id` | Público | HTTP 200 com `{ "auction": ... }`. |
| `PATCH /api/auctions/:id` | `AUCTIONEER` responsável | HTTP 200 com o leilão atualizado, somente em `DRAFT` e antes do início. |
| `PATCH /api/auctions/:id/cancel` | `AUCTIONEER` responsável | HTTP 200 com o leilão em `CANCELLED`, sem exclusão física. |

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

`npm test` executa as suítes de autenticação e leilões; `npm run typecheck`
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
