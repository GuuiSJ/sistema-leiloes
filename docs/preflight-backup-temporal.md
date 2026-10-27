# Inspeção e backup anterior à migração temporal

Inspeção concluída em **27/10/2026, 09:27 (America/Sao_Paulo)**; relatório de conclusão em `2026-10-27T12:27:48.761Z`. Esta etapa não aplicou migrações, não regenerou o Prisma Client, não ativou UTC, não alterou `.env`, registros financeiros ou eventos históricos, nem executou comandos Git.

## Banco e migrações

Identidade confirmada por `current_database()`: **sistema_leiloes**, PostgreSQL **17.11**. Consultas em transação **REPEATABLE READ READ ONLY**, também com leitura protegida na configuração da conexão. A inspeção e o dump compartilharam um snapshot PostgreSQL exportado.

| Migração | Estado |
| --- | --- |
| `20261024111646_init_modelagem` | Aplicação concluída; checksum compatível com arquivo local |
| `20261026120000_vehicle_owner` | Concluída; checksum compatível |
| `20261027000000_lot_ends_at` | Concluída; checksum compatível |
| `20261028000000_auction_temporal_generation` | Pendente; não executada |

Existe uma tentativa anterior da migração inicial marcada como revertida, sem conclusão e com checksum diferente. Ela foi seguida por uma aplicação concluída com checksum correto. Não é uma migração atualmente em falha e não foi modificada nesta inspeção. O status acima foi obtido somente lendo `_prisma_migrations` e comparando os arquivos locais; não foi executado CLI de migração.

A coluna `temporalGeneration` ainda não existe. Portanto os registros atuais são **não marcados**, e não se pode apresentar uma contagem materializada por LEGACY/UTC_V2. O default LEGACY será aplicado deterministicamente pela migração aditiva aprovada, quando executada.

| Status | Quantidade | Geração atual |
| --- | ---: | --- |
| DRAFT | 5 | Não marcada |
| SCHEDULED | 1 | Não marcada |
| OPEN | 0 | Não marcada |
| CLOSED | 2 | Não marcada |
| CANCELLED | 1 | Não marcada |
| Total | 9 | Não marcada |

Reservas financeiras **ACTIVE: 0**. Não houve consulta ou publicação de saldos individuais, dados pessoais, credenciais ou conteúdo público dos eventos no relatório.

## Processos e sessões

Nenhum processo `node.exe` foi encontrado na consulta local anterior ao backup. Foram observados sete processos PostgreSQL, sem tentativa de encerrá-los. Na consulta `pg_stat_activity`, nenhuma outra sessão estava ligada a `sistema_leiloes` naquele instante.

A inspeção detalhada de comandos via WMI/CIM foi negada pelo Windows; não é possível certificar a identidade/versão de todos os serviços, processos reiniciáveis ou agendamentos apenas com esse resultado. **Workers não estão certificados como definitivamente parados.** As observações são pontuais, e não garantem ausência de um processo que volte a iniciar depois. Antes da migração, o operador deve impedir reinicializações e confirmar a parada de todos os gravadores antigos.

## Auditoria histórica

Foram lidos **14 eventos**, todos v1. A cadeia foi **validada integralmente** pelo verificador de produção, incluindo sequência, encadeamento e SHA-256, sob a interpretação histórica fixa `America/Sao_Paulo`. Não houve busca por offsets alternativos.

Um fingerprint físico agregado da tabela foi comparado antes/depois do backup e permaneceu idêntico. Os hashes dos eventos e dados de autores não foram publicados. A verificação recalcula hashes somente em memória para comparação: nenhum hash ou timestamp foi gravado de volta.

## Backup

- Arquivo: `backups/sistema_leiloes_2026-10-27T12-27-48-162Z_046b64ea.dump`.
- Tamanho: **45.138 bytes** (aproximadamente 44,08 KiB).
- Formato PostgreSQL customizado, com estrutura, dados, sequências, definições de criação do banco, owners e ACLs disponíveis ao usuário do dump; sem filtros de tabelas ou schema.
- `pg_dump` e `pg_restore`: **17.11**.
- Dump concluído com código 0 e sem mensagens de aviso.
- `pg_restore --list`: código 0, banco esperado no cabeçalho e entradas de dados de **todas as 11 tabelas públicas**, incluindo `_prisma_migrations`.
- Leitura/descompressão completa com `pg_restore --file=NUL`: código 0, sem avisos. Foi gerado SQL somente para o dispositivo nulo, sem conexão de restauração ou execução desse SQL.
- SHA-256 do arquivo registrado no sidecar `.dump.sha256`.
- Checksum conferido novamente por `Get-FileHash`, com resultado idêntico ao sidecar.
- Evidência sanitizada em `backups/sistema_leiloes_2026-10-27T12-27-48-162Z_046b64ea.report.json`.

A pasta `/backups/` foi incluída em `.gitignore` antes da criação dos arquivos. Não houve comando Git. Conexão e senha são passadas aos subprocessos em ambiente privado, não em argumentos, relatórios ou documentação. O ambiente libpq é reconstruído para remover overrides de roteamento herdados; a identidade e o modo somente leitura são confirmados programaticamente antes do dump.

Arquivos de apoio criados: `backend/src/scripts/backup-temporal-preflight.ts` e `backend/tests/backup-temporal-preflight.test.ts`. `npm.cmd run typecheck` passou e os nove testes isolados das travas de destino/opções/credenciais passaram. A suíte anterior completa de 464 testes não foi repetida nesta etapa; nenhuma suite financeira foi habilitada contra o principal.

**Não foi realizado ensaio de restauração.** Listagem e descompressão comprovam legibilidade do archive, mas não comprovam uma restauração funcional completa, permissões no destino ou comportamento da aplicação recuperada. `pg_dump` não inclui criação de roles globais do cluster nem a configuração do servidor, extensões binárias, tablespaces físicos, arquivos externos ou credenciais. Roles/owners necessários devem existir no destino de recuperação, ou ser mapeados por um administrador. Não foram extraídas senhas de roles nem executado `pg_dumpall`.

## Impedimentos e próxima etapa

Não houve impedimento para gerar ou verificar o backup. O estado observado (0 OPEN, 0 ACTIVE e cadeia v1 válida) é favorável à preparação, mas **não é uma autorização de migração**.

Continuam pendentes: comprovar a parada dos gravadores, definir/verificar o procedimento de recuperação — idealmente com ensaio em destino aprovado — e executar a integração real da correção temporal. Os 464 testes anteriores sem banco não substituem essa integração. Este backup e esta inspeção não habilitaram as suites PostgreSQL financeiras ou de migração.

Após aprovação específica:

1. Confirmar o plano de recuperação e os responsáveis por roles/permissões. Não restaurar este archive sobre o principal como teste.
2. Drenar escritas, parar API/workers e impedir reinício dos processos antigos. Repetir contagens OPEN/ACTIVE, auditoria e status das migrações; interromper se o estado mudou de forma incompatível.
3. Gerar novo backup validado na janela se houver qualquer escrita posterior ao snapshot atual. Conferir checksum e disponibilidade do arquivo antes de prosseguir.
4. Somente então aplicar a migração temporal aditiva aprovada, sem reescrever dados ou hashes, e confirmar a classificação LEGACY dos nove registros existentes e o índice.
5. Regenerar o Prisma Client apenas após a coluna existir; executar verificações e o preflight de inicialização antes de qualquer ativação UTC_V2, seguindo `ativacao-utc-v2.md`.
6. Não usar fixtures financeiras destrutivas ou suites antigas no principal indiscriminadamente. Definir previamente quais validações são somente leitura e quais canários teriam autorização específica para criar dados.

Esta etapa para aqui e aguarda aprovação antes de qualquer modificação no banco.
