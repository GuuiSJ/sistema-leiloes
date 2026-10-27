# Inventário temporal — Etapa 1

O inventário não aplica classificações, não grava metadados e não corrige datas. Não é importado pelo servidor, rotas, worker ou repositórios financeiros. Os contratos TypeScript são preparatórios; nenhuma tabela foi adicionada.

## Execução

Na pasta `backend`, usando a conexão já configurada, sem modificar `.env`:

```powershell
node --import tsx src/scripts/inventory-temporal.ts
node --import tsx src/scripts/inventory-temporal.ts --summary
```

Depois do build: `node dist/scripts/inventory-temporal.js --summary`.

O primeiro comando produz NDJSON: uma linha `type: value` por campo/registro e um resumo final `type: summary`, `complete: true`. Somente relatórios com esse resumo final e saída de processo 0 são completos. Em falha, descarte as linhas parciais; o erro é genérico e não reproduz a mensagem do driver.

Não há parâmetro para escolher tabelas, campos, conexão ou fuso. Os identificadores SQL vêm de catálogo fixo. O script abre um `pg.Client` próprio, sem modificar o pool da aplicação ou o timezone, e inicia `REPEATABLE READ READ ONLY` antes das leituras. A paginação por UUID usa 500 registros por consulta. O epoch físico é calculado no PostgreSQL e publicado como string decimal, sem conversão de timestamp pelo adaptador Prisma.

## Catálogo

São 20 definições em dez modelos: User(createdAt, updatedAt); Vehicle(createdAt, updatedAt, fipeConsultedAt); Auction(startsAt, endsAt, createdAt, updatedAt); Lot(endsAt, createdAt, updatedAt); Bid(createdAt); Wallet(createdAt, updatedAt); WalletTransaction(createdAt); BidReservation(createdAt, updatedAt); AuctionReceipt(issuedAt); AuditEvent(occurredAt).

## Classificação conservadora

- `UNKNOWN`: falta prova confiável. Defaults do schema, `@updatedAt`, caminhos atuais de código e horário aparente não comprovam a origem histórica.
- `PARTIAL`: há representação temporal assinada comprovada, mas a origem da gravação continua UNKNOWN.
- `PROVEN`: encoding e origem comprovados. Nenhum caminho desta etapa inventa essa comprovação ou aceita classificações externas.
- `NOT_APPLICABLE`: valor nulo, sem instante. `Lot.endsAt` nulo continua representando herança, sem alterar a aplicação.

`originStatus` e `encodingStatus` são separados. O inventário verifica a cadeia completa v1 sob a hipótese histórica fixa America/Sao_Paulo, usando a zona IANA e o hash existente. Se a verificação funcionar, identifica a representação assinada e o epoch canônico apenas na memória. Isso não comprova qual gravador produziu o timestamp: origem permanece UNKNOWN. Cadeia inválida ou versão não suportada mantém a auditoria UNKNOWN. Não há busca por offsets alternativos, reparação ou alteração de hashes.

A hipótese São Paulo não é extraída do fuso atual da sessão. A cadeia é o critério de validação. A compatibilidade v1/v2 está preparada em [auditoria-versionada.md](auditoria-versionada.md), sem ativação do pool UTC. Em cadeia mista, o inventário usa epoch direto para verificar v2 e mantém a evidência legada restrita a v1; não atribui proveniência v2 automaticamente.

A preparação do pool, criação explícita UTC_V2, preflight e plano de virada estão em [ativacao-utc-v2.md](ativacao-utc-v2.md). A ativação permanece desabilitada. No futuro modo UTC, as respostas HTTP declararão o transporte por instante físico e o significado canônico legado UNKNOWN; não se deve confundir a mudança de representação do adapter com uma correção comprovada dos timestamps históricos.

O resumo distingue definições de campos de valores existentes. `values = proven + partial + unknown + nullValues`; `nonNullValues = proven + partial + unknown`. `provenOrigins` e `provenEncodings` contabilizam as duas dimensões separadamente.

## Privacidade

As linhas publicam somente modelo, campo, UUID técnico solicitado, epochs, classificação e códigos fechados de evidência. Não publicam nomes, e-mails, senhas, tokens, saldos, URL de conexão, conteúdo de publicData ou hashes de auditoria. Os UUIDs permitem correlação técnica; o relatório não é anônimo. Use `--summary` para compartilhar somente contagens. Nenhum relatório é salvo automaticamente.

## Testes

```powershell
node --import tsx --test tests/temporal-inventory.test.ts
$env:TEMPORAL_INVENTORY_DATABASE_TESTS = '1'
try {
  node --import tsx --test --test-concurrency=1 tests/temporal-inventory.test.ts tests/temporal-inventory.database.test.ts
} finally {
  Remove-Item Env:TEMPORAL_INVENTORY_DATABASE_TESTS
}
npm.cmd run typecheck
npm.cmd run build
```

A integração consulta o banco existente dentro de transação de leitura e confere a preservação da auditoria. Não cria tabelas, fixtures ou migrações. Os testes unitários cobrem as 20 definições, paginação, nulos, provas parciais, falhas, descarte de dados extras e validação dos contratos.
