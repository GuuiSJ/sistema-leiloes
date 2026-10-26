# Modelagem inicial do banco

Evolução posterior: o gravador mínimo de auditoria para abertura de leilões/lotes
foi autorizado e implementado sem mudança do schema. Seu contrato está em
[auditoria-abertura.md](auditoria-abertura.md); as transições controladas estão em
[gerenciamento-leiloes.md](gerenciamento-leiloes.md). As descrições de implementação
futura abaixo registram o estado da modelagem inicial.

O schema usa PostgreSQL e Prisma 7.10.1, com dez modelos. Nenhuma migração foi
aplicada nesta etapa. A primeira migração foi preparada posteriormente, conforme
descrito abaixo. Os nomes das tabelas seguirão os nomes dos modelos.

## Tabelas e relacionamentos

| Modelo | Finalidade e relações |
| --- | --- |
| `User` | Nome, e-mail único, `passwordHash` e papel `AUCTIONEER` ou `BIDDER`. Possui leilões, lances, lotes vencidos, comprovantes e no máximo uma carteira. |
| `Vehicle` | Marca, modelo, ano, versão, descrição, lista ordenada de URLs de imagens e referência FIPE opcional. Pode participar de lotes em diferentes leilões. |
| `Auction` | Título, descrição, responsável (`User`), início, término e estado. Possui vários lotes. |
| `Lot` | Relaciona um leilão a um veículo, com número, preço inicial, incremento mínimo, estado, vencedor opcional e versão para concorrência. |
| `Bid` | Lance de um usuário em um lote, com valor, data e sequência única por lote. O histórico não deve ser reescrito. |
| `Wallet` | Uma carteira por usuário, com saldo total e versão para concorrência. Possui transações e reservas. |
| `WalletTransaction` | Registro financeiro de crédito, reserva, liberação ou débito, com valor, saldo total após a operação, data e chave de idempotência única. Pode referenciar uma reserva da mesma carteira. |
| `BidReservation` | Posição comprometida por carteira/lote, ligada ao lance atual. Estados: `ACTIVE`, `RELEASED` ou `CAPTURED`. |
| `AuctionReceipt` | Um comprovante por lote e lance vencedor, com identificador público UUID, valor final e snapshot descritivo do leilão e veículo. |
| `AuditEvent` | Autor privado opcional (eventos de sistema não têm autor), ação, entidade, data, dados públicos permitidos e hashes da cadeia. |

## Tipos, índices e integridade

- Identificadores de domínio usam UUID. Valores monetários usam `Decimal(18,2)`,
  em reais (BRL), sem conversões por `Float`. Datas usam `timestamptz(3)`.
- Enums representam papéis, estados de leilões/lotes/reservas, transações e ações
  de auditoria. Não foram implementadas transições de estado.
- O e-mail tem unicidade no PostgreSQL; a comparação padrão diferencia maiúsculas
  de minúsculas. A futura camada de cadastro deverá normalizar os e-mails antes
  de persistir. O schema não calcula nem verifica hashes de senha por si só.
- Número de lote e veículo são únicos dentro de um mesmo leilão. Um veículo pode
  reaparecer em outro leilão; impedir participações simultâneas dependerá de regra futura.
- Índices cobrem leilões por estado/datas, lotes por leilão/estado, lances por
  lote/valor/data e usuário/data, reservas ativas por carteira ou lote, histórico
  financeiro por carteira/data e auditoria por entidade, autor ou ação/data.
- Chaves estrangeiras compostas garantem que a reserva associe o mesmo usuário
  à carteira e ao lance, e que o lance pertença ao lote indicado. O comprovante
  referencia um lance do próprio vencedor e lote. A transação financeira não
  pode apontar para uma reserva de outra carteira.
- Exclusões de registros relacionados usam `Restrict`, preservando referências
  históricas. Isso não torna os dados imutáveis nem impede alterações diretas.

## Saldo disponível e concorrência

`Wallet.balance` é o saldo total, sem subtrair reservas:

```text
saldo disponível = balance - soma(amount das reservas ACTIVE da carteira)
```

Existe uma única posição de reserva por carteira/lote. Um novo lance do mesmo
usuário atualiza essa posição e seu `bidId`; uma posição liberada pode ser
reativada. O histórico financeiro fica em `WalletTransaction`, com valores e
datas próprios; a relação com a reserva identifica a posição, não um snapshot
imutável de seu estado anterior. Os lances anteriores permanecem em `Bid`.

`CREDIT` aumenta o saldo total; `DEBIT` reduz o saldo total. `RESERVE` e `RELEASE`
alteram o comprometimento, sem mudar o saldo total. `amount` representa sempre
um valor positivo; nos aumentos de reserva, a transação registra a diferença.
`balanceAfter` é o snapshot do saldo total após a operação.

A implementação futura deverá executar cada lance em uma transação que confira
o lote, o maior lance, as versões e o saldo disponível; libere a reserva anterior;
atualize a posição do novo líder; registre os movimentos; e grave o lance com
sequência única. As versões de `Wallet` e `Lot` permitem controle otimista; elas
não são incrementadas automaticamente pelo schema. Poderão ser usados isolamento
serializável ou bloqueios, com tratamento de conflitos e tentativas limitadas.

Também deverão ser atômicos o encerramento do lote, a captura da reserva, o débito,
a definição do vencedor e a emissão do comprovante. A chave de idempotência evita
duplicar um movimento financeiro com a mesma chave, mas não substitui a transação.

## FIPE, comprovantes e auditoria pública

Os códigos FIPE, referência de mês, preço consultado e data da consulta são
opcionais. O preço FIPE é informativo e independente de `Lot.startingPrice` e dos
lances. Não há integração com BrasilAPI nesta etapa.

O comprovante preserva título do leilão, número do lote e descrição básica do
veículo na emissão. O `publicId` permite futura consulta/compartilhamento sem
publicar o identificador privado do usuário. A futura resposta pública deverá
usar uma seleção explícita de campos; não deve serializar o registro completo,
`winnerId` ou relações pessoais. O UUID não substitui autorização quando exigida.

`AuditEvent.publicData` aceita somente uma lista permitida de dados públicos por
ação. Não incluir nome, e-mail, senha, hash de senha, credenciais ou URLs com
segredos. `authorId` é uma referência privada e não deve ser exposto publicamente.
O tipo JSON não garante essa filtragem: ela deverá ser implementada antes de gravar.

`sequence` ordena a cadeia global; pode ter lacunas por rollback. `previousHash`
é nulo no evento inicial e único nos demais, evitando dois sucessores do mesmo
hash não nulo. `currentHash` é único. Os campos de hash comportam SHA-256 em
hexadecimal; não são calculados automaticamente. O schema não impõe referência
entre os hashes nem garante um único evento inicial, pois PostgreSQL permite
vários nulos em uma restrição única.

A implementação futura deverá serializar deterministicamente os campos públicos
incluídos no hash, definir sua versão de formato, usar SHA-256, serializar as
inserções concorrentes e verificar a cadeia completa, inclusive a existência de
um único evento inicial. Campos privados não devem ser necessários para verificar
o conteúdo público. A cadeia sozinha não impede reescrita integral ou exclusão
do final por um administrador; imutabilidade e ancoragem externa exigem medidas
adicionais. Nenhum desses mecanismos foi implementado nesta etapa.

## Decisões para aprovação antes da migração

1. Cada usuário terá um único papel. Permitir os dois papéis exigiria ajustar a modelagem.
2. Valores serão BRL com duas casas; o saldo disponível será calculado pelas reservas,
   sem um segundo saldo persistido. Haverá uma posição reutilizável por carteira/lote.
3. Veículos poderão reaparecer em leilões diferentes; haverá apenas um comprovante
   por lote, sem fluxo de reemissão/cancelamento nesta modelagem inicial.
4. Auditoria usará cadeia global e SHA-256; a lista pública de campos por ação,
   canonicalização e proteção contra reescrita deverão ser definidas antes de sua API.
5. Validação de valores positivos, saldo não negativo, datas coerentes, papéis
   permitidos, vínculo entre vencedor e maior lance, igualdade entre valor do
   comprovante e lance, e imutabilidade do histórico dependerão de implementação
   futura. Restrições SQL `CHECK` ou triggers adicionais poderão ser propostas em
   migração revisada, pois não estão expressas neste schema Prisma.

## Validação e próxima migração

Nesta etapa: `prisma format`, `prisma validate`, geração do client, verificação de
tipos e build. Esses comandos não criam as tabelas no PostgreSQL.

Migração inicial preparada, ainda não aplicada:

`backend/prisma/migrations/20261024111646_init_modelagem/migration.sql`.

Foi gerada pelo mecanismo oficial `prisma migrate diff`, comparando um estado
vazio ao schema, sem conexão de escrita nem banco sombra:

```powershell
npx.cmd prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20261024111646_init_modelagem/migration.sql
```

O arquivo `prisma/migrations/migration_lock.toml` identifica o provider PostgreSQL.
Antes da geração, a conexão foi validada com `SELECT 1`, o nome do banco foi
conferido como `sistema_leiloes` e não havia tabelas no schema `public`.

Somente após aprovação, para aplicar a migração já preparada, na pasta `backend`:

```powershell
npm.cmd run prisma:migrate:deploy
```

Esse comando aplica as migrações pendentes e registra seu histórico, sem gerar
nova migração nem exigir banco sombra. Se o banco tiver sido alterado desde a
preparação, revisar sua estrutura antes de aplicar. Não executar `resolve`,
reset ou `db push` para contornar divergências sem analisar a causa.
