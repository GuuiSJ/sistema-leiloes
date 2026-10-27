# Preparação do marcador temporal de leilões

Esta entrega prepara schema, SQL de migração, bloqueios operacionais e testes. **A migração não foi aplicada e o Prisma Client não foi regenerado. Os bloqueios estão implementados no código, validados somente com mocks e fixtures em memória.** A auditoria v1/v2 está preparada em `auditoria-versionada.md`; não há ativação de UTC no pool ou implantação. Esta versão ainda não deve ser iniciada contra o banco atual: as escritas protegidas e a descoberta do worker exigem a coluna nova.

## Modelo

```prisma
enum AuctionTemporalGeneration {
  LEGACY
  UTC_V2
}

// Em Auction:
temporalGeneration AuctionTemporalGeneration @default(LEGACY)
@@index([temporalGeneration, status])
```

O marcador é interno. Não é derivado de createdAt, datas aparentes, fuso atual ou estado do leilão. O contrato REST atual já rejeita esse campo em POST/PATCH; o cliente não pode promover registros para UTC_V2. A criação explícita UTC_V2 está preparada e condicionada à prontidão verificada, conforme `ativacao-utc-v2.md`; não foi ativada.

O índice atende à futura descoberta por geração/status no worker. Lotes herdam a geração de seu leilão; não haverá um segundo marcador que possa divergir do pai. Isso não classifica timestamps históricos de outros modelos.

## Migração preparada, não executada

Arquivo: `backend/prisma/migrations/20261028000000_auction_temporal_generation/migration.sql`.

A migração cria o enum, adiciona a coluna obrigatória com DEFAULT LEGACY e cria o índice. A definição constante da coluna identifica deterministicamente todos os leilões existentes como LEGACY quando o SQL for aplicado, sem UPDATE e sem alterar startsAt, endsAt, status, updatedAt ou qualquer dado financeiro. Inserções que omitirem o marcador também serão LEGACY, inclusive por uma versão antiga do backend.

O DEFAULT permanece LEGACY após a migração. Somente o backend corrigido, com UTC e auditoria compatível já validados, poderá gravar UTC_V2 explicitamente. Não se deve alterar o default global para antecipar essa ativação.

O SQL usa BEGIN/COMMIT e lock_timeout de dez segundos. ALTER TABLE exige lock; contenção pode fazer a transação falhar, sem aplicação parcial. Não há DROP, reset, db push, reescrita de datas ou alteração de hashes. Usuários, carteiras, saldos, reservas capturadas, comprovantes e AuditEvent não são modificados.

Não execute migrate deploy/dev nesta preparação. O client gerado atual corresponde ao banco atual; regenerá-lo e utilizá-lo antes de existir a coluna pode causar erro de coluna ausente nas consultas Prisma.

## Testes executáveis nesta etapa

`auction-temporal-model.test.ts` valida o contrato entre schema e SQL, DDL aditivo, padrão seguro, ausência de inferências e rejeição do marcador pelo REST. Não executa DDL.

`auction-temporal-acceptance.test.ts` mantém consultas históricas funcionando em todos os estados e implementa os seis testes TDD antes marcados TODO. Eles chamam os serviços/repositórios reais com dependências em memória e verificam:

- LEGACY não agenda nem abre.
- LEGACY não altera o prazo.
- LEGACY não recebe lance/reserva/prorrogação/evento novo.
- Liquidação ignora LEGACY antes do caminho financeiro.
- Worker filtra UTC_V2 tanto nos lotes OPEN quanto na recuperação de leilões terminais.

Os seis testes agora devem passar sem TODO. `auction-temporal-isolation.test.ts` acrescenta regressões dos repositórios reais: callbacks permissivos não contornam os bloqueios, marcadores ausentes/desconhecidos falham fechados, mutações vinculadas são bloqueadas e replay não duplica operações financeiras. Também verifica novos lances e encerramento sem lance em UTC_V2 com mocks. Isso não substitui integração PostgreSQL.

```powershell
npm.cmd run prisma:validate
npm.cmd run typecheck
node --import tsx --test tests/auction-temporal-model.test.ts tests/auction-temporal-acceptance.test.ts
npm.cmd test
```

Nenhum desses comandos aplica a migração. Não habilitar suítes PostgreSQL que pressupõem a coluna nova enquanto banco, client e fixtures não estiverem alinhados.

## Próxima etapa, sujeita a aprovação

1. Revisar os guards e filtros implementados nesta etapa e a evidência em `bloqueios-operacionais-legacy.md`; alinhar as fixtures PostgreSQL com a coluna nova antes de executar integração.
2. Validar a cadeia v1/v2, o pool UTC, o preflight e o gravador explícito UTC_V2 preparados, em PostgreSQL isolado e sem modificar hashes antigos. O código antigo não pode operar simultaneamente com o novo após a virada. Ver `ativacao-utc-v2.md` para a sequência de aprovação e ativação.
3. Revalidar a ausência de leilões OPEN e reservas ACTIVE antes da implantação. Se houver disputa ativa, interromper a virada para decisão específica.
4. Em janela controlada, drenar escritas e parar o worker; aplicar apenas a migração aprovada, regenerar o client, validar e iniciar a versão completa corrigida. Não deixar uma versão com coluna nova, mas sem os guards, processando leilões antigos.
5. Conferir que os registros antigos estão LEGACY e preservam datas/estados/finanças/hashes; novos registros de teste devem ser explicitamente UTC_V2 e passar pelo fluxo completo.

A consulta histórica será preservada. Leilões LEGACY não serão automaticamente cancelados, promovidos, reabertos ou liquidados. Essa etapa não autoriza a janela de implantação nem a execução do SQL.
