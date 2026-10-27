# Procedimento final — ainda não autorizado para execução

## Resultado da última barreira

**Não estamos aptos a executar a migração.** A operação foi interrompida na identificação dos gravadores, conforme solicitado.

- `Get-Process`: nenhum processo Node visível naquele instante.
- Consulta PostgreSQL somente leitura: identidade `sistema_leiloes` confirmada; nenhuma outra sessão nesse banco naquele instante.
- WMI/CIM: acesso negado à inspeção detalhada de processos.
- Listeners TCP: inspeção indisponível.
- Não foi possível certificar a parada de serviços, containers, tarefas agendadas, PM2, processos de outros usuários ou gravadores reiniciáveis/remotos.
- Nenhum processo foi encerrado. Nenhuma migração, regeneração ou ativação foi executada.

As contagens OPEN/ACTIVE, migrações, auditoria e arquivo de backup **não foram revalidados nesta execução**, pois a barreira de processos falhou. Os resultados anteriores — zero OPEN, zero ACTIVE, 14 eventos v1 válidos e backup legível — são históricos, não uma nova certificação do estado atual.

O relatório anterior registra apenas um fingerprint agregado da auditoria comparado durante o backup; não contém um manifesto de todos os dados/sequências que permita provar agora ausência de qualquer escrita desde aquele snapshot. Não devemos inferir ausência de escritas a partir de contagens iguais, timestamps aparentes ou cadeia de auditoria válida. Se não for possível demonstrar ausência de alterações, gerar um novo backup validado após parar os gravadores, em vez de considerar o antigo atualizado.

## Sequência futura e condições de interrupção

Todos os comandos abaixo são **instruções para uma janela futura aprovada**, não comandos executados nesta etapa. Os comandos Node/npm devem ser executados em `backend/`. Não contêm credenciais e não editam `.env`.

### 1. Identificar e parar os gravadores

Um operador com acesso suficiente deve inventariar PID, usuário, executável, diretório da aplicação, comando e mecanismo de reinício dos servidores/workers. Examinar serviços Windows, tarefas agendadas, PM2, containers e outros hosts que possam acessar o banco. Não publicar linhas de comando brutas que possam conter segredos.

Drenar requisições e aguardar transações em andamento; então parar somente os processos identificados e desabilitar seus mecanismos de reinício durante a janela. Conferir listeners e `pg_stat_activity` com visibilidade suficiente. Registrar a evidência de parada sem credenciais.

**Interromper:** identidade/função de processo desconhecida, falta de acesso, sessão potencialmente gravadora sem explicação ou mecanismo de reinício não controlado. **Recuperação:** manter a migração suspensa; obter confirmação operacional. Não matar PIDs por tentativa nem reiniciar versões antigas automaticamente.

### 2. Revalidar banco e obter o backup da janela

Confirmar por SQL `current_database() = 'sistema_leiloes'`, PostgreSQL 17.11 e transação READ ONLY. Conferir `_prisma_migrations`: somente `20261028000000_auction_temporal_generation` deve estar pendente; as três aplicações concluídas anteriores devem corresponder aos arquivos locais. A tentativa inicial revertida conhecida não pode ser confundida com uma nova falha pendente.

Verificar novamente ausência da coluna, zero leilões OPEN, zero reservas ACTIVE e a cadeia completa v1 com a projeção IANA histórica. Conferir outras sessões. Revisar a evidência de escritas desde o backup; se ela for insuficiente, tratar o backup anterior como potencialmente desatualizado.

Com os gravadores já parados, executar:

```powershell
node --import tsx src/scripts/backup-temporal-preflight.ts
```

Exigir sucesso, nenhuma advertência não explicada e guardar o novo `.dump`, `.dump.sha256` e `.report.json` ignorados por `/backups/`. Conferir o checksum independentemente. Comparar novo estado somente leitura antes/depois, incluindo todos os dados/sequências necessários, sem expor registros. O script existente garante snapshot comum da inspeção/dump e fingerprint da auditoria, mas não é uma prova global de ausência de escritas externas.

Para revalidar o arquivo anterior especificamente, sem restaurar:

```powershell
$migrationBackup = (Resolve-Path -LiteralPath '..\backups\sistema_leiloes_2026-10-27T12-27-48-162Z_046b64ea.dump').Path
$migrationExpected = (Get-Content -LiteralPath ($migrationBackup + '.sha256')).Split(' ')[0]
$migrationActual = (Get-FileHash -LiteralPath $migrationBackup -Algorithm SHA256).Hash.ToLowerInvariant()
if ($migrationActual -ne $migrationExpected) { throw 'Checksum do backup divergente.' }
& 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe' --list $migrationBackup
if ($LASTEXITCODE -ne 0) { throw 'Listagem do backup falhou.' }
& 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe' --file=NUL $migrationBackup
if ($LASTEXITCODE -ne 0) { throw 'Leitura completa do backup falhou.' }
```

A listagem é local e deve ser tratada como informação administrativa. Não publicá-la integralmente.

**Interromper:** banco diferente, auditoria inválida, OPEN/ACTIVE, migração inesperada, escrita durante a janela ou falha/advertência não explicada no backup. **Recuperação:** manter gravadores parados e investigar; produzir novo backup após estabilizar. A restauração continua **não testada**: legibilidade do archive não comprova recuperação funcional. Não restaurar sobre o principal como ensaio; definir previamente destino, roles e responsável pela recuperação.

### 3. Aplicar somente a migração aprovada

Este passo exige aprovação explícita posterior. Imediatamente antes do comando, confirmar programaticamente a identidade da conexão e que o único arquivo pendente é o temporal revisado. Se aparecer qualquer outra migração, não executar `deploy`.

```powershell
npm.cmd exec -- prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw 'Migração não concluída; manter gravadores parados.' }
```

Confirmar em leitura: registro Prisma concluído, enum LEGACY/UTC_V2, coluna NOT NULL com default LEGACY, índice válido e nove registros históricos LEGACY — ou a contagem documentada pelo novo snapshot, se tiver mudado antes da janela. Comparar dados, datas, finanças e hashes ao manifesto prévio, descontando apenas o marcador adicionado e o registro de migração esperado.

**Interromper:** timeout/lock, falha do comando, migração incompleta, índice inválido ou qualquer alteração histórica inesperada. **Recuperação:** não repetir cegamente, não usar reset/db push/resolve ou rollback manual sem revisão. Manter escrita suspensa e inspecionar o estado. A migração preparada é transacional, mas sua conclusão deve ser confirmada, não presumida.

### 4. Regenerar o client e validar o artefato

Somente após confirmar a coluna no banco:

```powershell
npm.cmd run prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Geração falhou.' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Tipagem incompatível; não iniciar o servidor.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build falhou; não iniciar o servidor.' }
```

Executar a suíte sem banco com as flags de integração desabilitadas. **Não usar `npm test` com flags PostgreSQL herdadas**, pois suites antigas podem criar/remover fixtures no principal. O client regenerado pode exigir atualização das fixtures tipadas; essa compatibilidade ainda não foi demonstrada.

**Interromper:** falha de geração, tipos, build ou testes. **Recuperação:** corrigir o artefato mantendo API/workers parados. Não executar o client regenerado contra um banco sem a coluna e não iniciar um gravador antigo para contornar a falha.

### 5. Preparar a configuração UTC_V2 sem liberar tráfego

Confirmar URL sem opções de sessão conflitantes, schema/client alinhados e configuração da aplicação `AUCTION_TEMPORAL_MODE=UTC_V2` somente no processo de implantação aprovado. O pool deve receber `-c timezone=UTC` em todas as conexões. Não alterar o default global LEGACY do banco nem promover registros históricos.

**Interromper:** configuração ambígua, URL com overrides ou processo antigo ainda disponível para reinício. **Recuperação:** não iniciar serviços; corrigir a configuração de implantação. Nenhuma flag deve ser usada para forçar passagem por uma falha de preflight.

### 6. Executar o preflight antes de iniciar o servidor

Executar um processo dedicado que encerra sem abrir HTTP nem iniciar o worker:

```powershell
node --import tsx -e "process.env.AUCTION_TEMPORAL_MODE='UTC_V2'; const db=require('./src/lib/prisma'); (async()=>{try{await db.connectDatabase(); console.log('Preflight aprovado.');}catch{process.exitCode=1; console.error('Preflight recusado; não iniciar serviços.');}finally{await db.disconnectDatabase();}})();"
if ($LASTEXITCODE -ne 0) { throw 'Ativação interrompida pelo preflight.' }
```

Exigir confirmação de schema, client, migração, tipos temporais, ausência de operações LEGACY ativas, timezone UTC, epoch de leitura/parâmetro e cadeia v1/v2. Esse processo não configura persistentemente o servidor; o processo de implantação também deve receber o modo correto. O bootstrap normal repetirá o preflight antes de abrir HTTP/Socket.IO e permitir o worker.

**Interromper:** qualquer falha ou diferença de epoch. **Recuperação:** manter serviços parados, diagnosticar o código de incompatibilidade sem expor conexão ou SQL privado; não desativar o gate.

### 7. Validar o histórico antes de autorizar canários

Repetir verificações somente leitura e comparar o prefixo dos 14 eventos v1 — ou o prefixo aprovado no snapshot novo — com seus dados/hashes originais. Usar `loadAuditChain`, nunca a Date bruta de um pool com outro fuso. Confirmar bloqueios LEGACY e disponibilidade das consultas autorizadas de leilões, lotes, lances e comprovantes.

Conferir o campo HTTP `temporal`: UTC transporta instantes físicos armazenados, sem normalizar o significado canônico desconhecido do legado. Essa representação pode diferir do texto de data anteriormente retornado; o consumidor precisa reconhecer o contrato. Não aplicar offsets fixos para simular compatibilidade.

**Interromper:** diferença não autorizada em histórico, hash, finanças ou autorização; consumidor incapaz de tratar a mudança de representação. **Recuperação:** suspender a liberação e investigar. Não recalcular hashes persistentes, reescrever datas ou liberar LEGACY para corrigir o problema.

### 8. Executar canários financeiros somente com autorização específica

Como não haverá outro banco, não executar suites destrutivas de integração no principal. Preparar previamente contas, lotes, valores, chaves idempotentes e resultados esperados de canários identificáveis; isso envolve novas escritas financeiras e precisa de aprovação separada. Não utilizar dados financeiros existentes como fixtures, nem apagar evidências/auditoria após o teste.

Após essa autorização, iniciar uma única instância compatível em acesso restrito e validar, nesta ordem: criação UTC_V2; epochs físicos das datas/defaults; agendamento/abertura; crédito autorizado; lance/reserva; replay sem duplicação; anti-sniping; concorrência controlada; rollback controlado sem confirmar débito parcial; encerramento pelo worker; captura única/comprovante; primeiro evento v2 vinculado ao último v1 e rejeição de regressão v2 → v1. Não injetar falhas indiscriminadamente em transações reais do usuário.

Os roteiros/fixtures desses canários ainda precisam ser preparados e revisados: este documento não autoriza executá-los. As suites PostgreSQL existentes exigem adaptação ao schema/geração/auditoria e não constituem um roteiro seguro para o principal.

**Interromper:** divergência de saldo/reserva/débito, captura duplicada, evento antes do commit, hash inválido ou escrita LEGACY. **Recuperação:** parar novas escritas, preservar logs sanitizados/ledger/auditoria e corrigir adiante com revisão. Depois de v2/novas operações, não reiniciar gravadores antigos nem restaurar o backup automaticamente: uma restauração poderia descartar operações posteriores e exige decisão explícita e reconciliação.

## Critério para solicitar nova aprovação

Só apresentar a migração como executável depois de superar a inspeção de gravadores, obter backup atual validado e acordar o procedimento de recuperação. Integração real, compatibilidade do client regenerado, contrato histórico dos consumidores e canários financeiros continuam sendo pendências explícitas; não foram provados pelos testes sem PostgreSQL.
