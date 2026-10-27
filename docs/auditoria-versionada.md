# Auditoria SHA-256 v1 → v2

Implementação preparada e testada sem PostgreSQL. Não foram aplicadas migrações, regenerado o Prisma Client, ativado UTC no pool, modificados `.env`/credenciais ou executados comandos Git. Nenhum evento histórico foi atualizado. Esta entrega não autoriza iniciar o backend contra o banco atual nem realizar a virada.

## Identificação e contrato dos hashes

A versão é determinada exclusivamente por `publicData.formatVersion`:

| Valor | Contrato |
| --- | --- |
| Campo ausente | v1, sem acrescentar o campo aos dados assinados |
| Número `1` | v1 |
| Número `2` | v2 |
| Qualquer outro valor explícito, inclusive null ou string | Erro controlado 409 |

Não há inferência por data, status ou hash, nem tentativa de offsets até encontrar um hash válido.

O envelope v1 continua exatamente com os campos `formatVersion: 1`, `id`, `sequence` (string decimal), `action`, `entityType`, `entityId`, `occurredAt` (`Date.toISOString()` da representação assinada), `publicData` original e `previousHash`. A canonicalização original foi preservada: chaves de objetos ordenadas por `Object.keys(...).sort()`, arrays na ordem original, primitivos escapados por `JSON.stringify`, sem espaços. SHA-256 dos bytes UTF-8, hexadecimal minúsculo. Eventos sem versão mantêm o envelope externo v1 e seu `publicData` sem alteração.

O envelope v2 usa os mesmos campos, com `formatVersion: 2` e o discriminador adicional `timestampEncoding: "UTC_ISO8601_MILLISECONDS"`. `publicData.formatVersion` é obrigatoriamente o número `2`. `occurredAt` representa o instante UTC real, serializado com milissegundos e `Z`. O discriminador e as duas versões integram o hash; v2 não reutiliza o domínio de assinatura v1.

Vetores congelados em `versioned-audit.test.ts`:

- v1 explícito: `03d14d0c649ff543ae7baede3ff085206d8423b68ca9588c7c6b8cff69c08b60`.
- v1 sem versão: `c8ec893ceb0d4b2088d8ef6037359efade6f1bd9e2b6a633a2137963359b908c`.
- v2: `31731cb6fc215951d76254e3b216f73fc26c1329c17867f0918f7160641e9d86`.

São fixtures sintéticas públicas, não eventos copiados de produção.

## Leitura e preservação histórica

`verifyOpeningAuditChain` é um verificador puro: recebe datas já na representação assinada. Não tenta corrigir datas. Para ler do banco, usar `loadAuditChain(tx)`, que evita a conversão de timestamps do adapter:

- v1: epoch da projeção histórica fixa `((occurredAt AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC')`, a mesma comprovada na etapa de caracterização/inventário. A zona IANA considera suas regras históricas; não há offset constante nem dependência do fuso da sessão.
- v2: epoch físico direto de `occurredAt`.

Essa projeção é apenas leitura. A verificação calcula hashes em memória para comparar com os armazenados; não grava hashes calculados ou datas projetadas. Versões desconhecidas falham na validação, sem fallback para outro contrato. `authorId` não é selecionado pelo loader; permanece excluído do envelope público conforme o contrato anterior.

O inventário agora consegue verificar uma cadeia mista sem perder a prova do prefixo v1. Seu código de evidência legado não é aplicado a eventos v2; a classificação v2 permanece conservadoramente UNKNOWN até a etapa própria de proveniência.

## Gravação e concorrência

O gravador único aceita apenas novos eventos v2, inclusive se a cadeia estiver vazia ou contiver somente v1. Abertura e encerramento/liquidação já passam o formato 2. A whitelist pública continua permitindo somente os campos específicos de cada ação; email, autor, carteira, saldo, valor financeiro e tokens não são aceitos em `publicData`. A referência privada `authorId` permanece em coluna própria, sem integrar o envelope público.

`prepareAuditWriter` usa o mesmo TransactionClient da operação, adquire `LOCK TABLE "AuditEvent" IN SHARE ROW EXCLUSIVE MODE`, lê/verifica a cadeia inteira, aloca sequência e insere o evento. O INSERT é parametrizado e grava `occurredAt` via `to_timestamp(epochMs / 1000.0)`, sem passar `Date` pelo adapter. Isso prepara gravação UTC correta mesmo sem mudar o pool; não ativa UTC globalmente.

O primeiro evento v2 usa exatamente o último `currentHash` v1 como `previousHash`. Depois, a cadeia segue v2. O verificador rejeita regressão v2 → v1, mesmo se os hashes individuais tiverem sido calculados corretamente. O gravador não oferece opção de gravar v1.

Appends concorrentes no mesmo gravador são enfileirados para não criar bifurcações. Dados e data do chamador são copiados antes de aguardar a fila. Uma falha de INSERT rejeita os próximos appends dessa fila. A transação externa deve propagar a falha, nunca capturá-la para confirmar uma operação parcial.

Os repositórios de abertura e liquidação mantêm Serializable e seus retries de serialização/deadlock existentes. Lacunas de sequência após rollback são válidas. O lock é mantido até commit/rollback; hashes/ponteiros só avançam localmente após o INSERT bem-sucedido.

A proteção vale para os gravadores desta versão. Sem trigger ou alteração de permissões do banco, não é possível impedir um processo antigo de inserir v1 depois de liberar o lock. Antes da implantação, parar todos os gravadores antigos e impedir versões simultâneas. Nenhum mecanismo adicional foi instalado no banco nesta etapa.

## Arquivos desta etapa

- `backend/src/modules/audit/opening-audit.ts`: identificação, contratos, cadeia mista, loader e gravador v2.
- `backend/src/modules/settlement/settlement.repository.ts`: dados públicos dos novos eventos em formato 2.
- `backend/src/modules/temporal/temporal-inventory.ts`: projeção por versão e evidência restrita a v1.
- `backend/tests/versioned-audit.test.ts`: vetores, UTC, cadeia mista, downgrade, privacidade, adulteração, concorrência/rollback simulados e preservação histórica.
- `backend/tests/opening-audit.test.ts`: versão desconhecida agora usa 3, preservando o vetor original v1.
- `backend/tests/auction-temporal-isolation.test.ts`: mock de auditoria atualizado para o loader/INSERT explícitos.
- `backend/tests/temporal-inventory.test.ts`: regressão do inventário com cadeia mista.
- `docs/auditoria-versionada.md`, `docs/inventario-temporal.md`, `docs/geracao-temporal-leiloes.md` e `docs/bloqueios-operacionais-legacy.md`: contrato e estado da preparação.

## Validação e integração pendente

Executados em `backend/`: `npm.cmd run typecheck` e a suíte inteira sem PostgreSQL, selecionando os arquivos `tests/*.test.ts` que não contêm `DATABASE_TESTS` e passando essa lista a `node --import tsx --test`. Resultado: **441 testes aprovados**, zero falhas, skips ou TODOs. Inclui os 416 testes anteriores e 25 regressões adicionais.

Os testes de concorrência e rollback usam staging e lock em memória e executam o gravador real. Não comprovam o comportamento de SSI/locks do PostgreSQL nem validam o SQL no servidor. Nenhuma conexão ao banco foi aberta para essa validação.

Após autorização, validar em PostgreSQL isolado:

1. Leitura do histórico existente pelas sessões America/Sao_Paulo e UTC usando o loader, com fingerprint físico idêntico antes/depois. Esta verificação somente leitura não exige a coluna nova de Auction; não foi executada nesta entrega.
2. Executar os SQLs de projeção e INSERT com o adapter atual em ambos os fusos; conferir epoch físico, precisão de milissegundos, tipos enum/UUID/JSONB e igualdade do hash após releitura. Incluir datas históricas com horário de verão, usando a zona IANA fixa.
3. Duas conexões Serializable concorrentes, primeira inserção em cadeia vazia, passagem v1 → v2, transação que aguardou lock com snapshot anterior, retries 40001/40P01 e unicidade do encadeamento.
4. Falhas de INSERT/auditoria durante abertura e captura: rollback integral de status, reservas, ledger, carteira e comprovante; nenhum evento de socket antes do commit.
5. Alinhar fixtures operacionais com a migração aditiva de geração temporal, sem aplicá-la no banco atual. Os testes PostgreSQL antigos que interceptam `auditEvent.create` precisam interceptar o INSERT SQL; os que verificam datas diretamente do ORM precisam usar o loader. A suíte de caracterização exclusivamente v1 deve distinguir prefixo v1 de uma cadeia mista.

A auditoria isolada não exige nova coluna ou migração própria. O pool UTC, a criação explícita UTC_V2 e a verificação de inicialização estão preparados em `ativacao-utc-v2.md`, sem ativação. Os fluxos completos continuam dependendo da migração de `temporalGeneration`, do client alinhado e da validação PostgreSQL. Nada disso foi aplicado no ambiente atual.
