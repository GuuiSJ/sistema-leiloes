# Plano final UTC_V2 — aguardando autorização

## Validação pós-migração preparada

Estado mais recente informado pelo usuário: migração aplicada, nove LEGACY, NOLOGIN e zero sessões; client regenerado, typecheck, 473 testes e build aprovados. Os registros de interrupção abaixo são o histórico das tentativas anteriores, não uma nova consulta ao banco.

Para confirmar o estado atual sem liberar serviços, executar em `backend/`:

```powershell
powershell -NoProfile -File .\src\scripts\verify-post-utc-admin.ps1
```

Esse é o único ponto de entrada manual; usa o auxiliar TypeScript `verify-post-utc-admin.ts`. Solicita a senha de postgres ocultamente, por pipe, sem modificar `.env` nem passar senha em argumentos. Exige o checksum já aprovado de `sistema_leiloes_pre_utc.dump`, lê o conteúdo em memória por pg_restore sem restaurar e compara os campos existentes das onze tabelas com o banco. Somente a nova coluna de geração e a nova linha da migração são mudanças esperadas; os valores do histórico e das migrações anteriores devem permanecer iguais. Timestamps são comparados pelo instante físico com precisão de microssegundos; dados privados e hashes individuais nunca são publicados.

O script exige banco correto, migração concluída/checksum compatível, nove LEGACY, zero OPEN/ACTIVE, NOLOGIN e zero sessões da aplicação. Valida exatamente 14 eventos v1 pelo verificador existente e exige que seus hashes armazenados correspondam ao backup. Só então executa o preflight de produção com runtime local e pool dedicado UTC **READ ONLY em todas as conexões**, sem singleton operacional, HTTP ou worker. Qualquer divergência retorna complete=false e código não zero. Não executa DDL, LOGIN, restauração ou escrita financeira.

Validação local desta ferramenta: typecheck e seis testes isolados aprovados; checksum e parsing real do backup aprovados (onze tabelas, nove leilões, 14 eventos). Comparação com o banco e preflight real ainda dependem da execução administrativa manual. Restauração funcional continua não testada. A comparação é de registros/timestamps do snapshot, não de arquivos físicos do cluster, sequências externas ou artefatos fora do banco; assume manutenção sem outros gravadores administrativos concorrentes.

Registro de execução: autorização controlada recebida para migrar e validar, mantendo NOLOGIN e serviços parados. Execução interrompida antes das verificações de banco e do DDL: o processo disponível está configurado como `leiloes_app`, sem conexão administrativa temporária. Nenhuma migração, regeneração, ativação, liberação de LOGIN ou inicialização foi executada. Typecheck, testes, build e preflight desta execução não foram iniciados; dependem primeiro da migração autorizada e do acesso administrativo. A autorização permanece registrada, mas não substitui a autenticação necessária nem os gates do procedimento.

Nenhum comando deste plano foi executado nesta etapa. Manter `leiloes_app` NOLOGIN, API/workers parados e seus mecanismos de reinício desativados até a liberação indicada abaixo. O usuário confirmou a validação administrativa: banco correto, 14 eventos v1 válidos, zero sessões da aplicação, zero OPEN/ACTIVE e migração ausente.

## Arquivos confirmados

- Migração `backend/prisma/migrations/20261028000000_auction_temporal_generation/migration.sql`: transação com lock_timeout de 10 segundos, enum LEGACY/UTC_V2, coluna NOT NULL DEFAULT LEGACY e índice geração/status. Corresponde ao schema Prisma; não altera datas ou hashes.
- Configuração: `AUCTION_TEMPORAL_MODE=UTC_V2` é explícita; cada conexão do pool recebe `-c timezone=UTC`; overrides de fuso na URL são recusados.
- Preflight implementado: schema/client/migração, tipos, operações LEGACY ativas, leitura/parâmetro/epoch e cadeia versionada. HTTP e worker aguardam sua conclusão. Criação UTC_V2 depende dessa prontidão.

## 1. Gate final, antes de qualquer DDL

Em `backend/`, executar o verificador administrativo existente, somente leitura:

```powershell
powershell -NoProfile -File .\src\scripts\verify-legacy-audit-admin.ps1
if ($LASTEXITCODE -ne 0) { throw 'Não aplicar a migração.' }
```

Exigir novamente o resultado aprovado: complete=true, sistema_leiloes, 14 eventos v1, chainValid=true, appLogin=false, appSessions=0, open=0, active=0, temporalMigrationApplied=false. A senha é solicitada ocultamente e não deve ser colocada em comando/chat. O verificador rejeita mudança nesses critérios. Se o estado mudou desde o backup, renovar o backup antes de prosseguir.

O arquivo `backups/sistema_leiloes_pre_utc.dump` já foi lido integralmente. SHA-256 aprovado:
`61ae2a22510f88c6cd20b80154cd0192ff9a8e549a48d1cbaed95e223ea29c5f`.
Se o arquivo for substituído ou surgir escrita administrativa posterior, a validação/backup precisam ser atualizados. Restauração funcional não foi testada.

## 2. Migração administrativa e artefato, em um terminal temporário

Executar o bloco abaixo **somente após autorização explícita**. O prompt pede a URL administrativa completa de `postgres`, digitada/pastada ocultamente, para o mesmo host/porta/banco já verificados. Não escrevê-la como literal no histórico nem salvá-la em `.env`. Nenhuma configuração de pool da aplicação será ativada por este bloco.

`migrate deploy` aplica **todas** as migrações pendentes: não existe aqui uma opção para selecionar somente uma pelo nome. Por isso, a execução fica dividida em A/B: revisar o status antes de autorizar B. Se aparecer qualquer outra pendência ou falha não resolvida, parar. A tentativa inicial revertida conhecida é histórica; as aplicações concluídas das três migrações anteriores precisam permanecer válidas.

### A — Abrir o contexto administrativo e conferir o destino/status

Colar no mesmo terminal PowerShell em `backend/`:

```powershell
$utcSavedUrl = $env:DATABASE_URL
$utcSavedMode = $env:AUCTION_TEMPORAL_MODE
$utcSecureUrl = Read-Host 'URL administrativa de postgres para sistema_leiloes (oculta)' -AsSecureString
$utcPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($utcSecureUrl)
try {
    $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($utcPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($utcPointer)
    Remove-Variable utcSecureUrl
}
$env:AUCTION_TEMPORAL_MODE = 'LEGACY'
node -e "const {Client}=require('pg');(async()=>{let c;try{const u=new URL(process.env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||decodeURIComponent(u.pathname.slice(1))!=='sistema_leiloes'||decodeURIComponent(u.username)!=='postgres'||[...u.searchParams.keys()].some(k=>!['schema','sslmode','sslcert','sslkey','sslrootcert'].includes(k))||(u.searchParams.has('schema')&&u.searchParams.get('schema')!=='public'))throw Error();c=new Client({connectionString:u.toString(),options:'-c default_transaction_read_only=on',connectionTimeoutMillis:5000});await c.connect();const {rows:[r]}=await c.query('SELECT current_database() AS db,session_user AS role');if(r.db!=='sistema_leiloes'||r.role!=='postgres')throw Error();console.log('Destino administrativo confirmado.');}catch{process.exitCode=1;console.error('Destino administrativo recusado.');}finally{if(c)await c.end();}})();"
if ($LASTEXITCODE -ne 0) { throw 'Parar: destino não confirmado. Executar limpeza C.' }
npm.cmd run prisma:migrate:status
```

O status pode retornar código não zero por migração pendente. Não usar esse código como autorização: verificar que a única pendente é exatamente `20261028000000_auction_temporal_generation`. Se houver erro de conexão/status, limpar o contexto com C e interromper. Não rodar B.

### B — Aplicar e verificar; gerar, testar e compilar

Somente com A aprovado e no mesmo terminal, executar:

```powershell
try {
    npm.cmd run prisma:migrate:deploy
    if ($LASTEXITCODE -ne 0) { throw 'Migração falhou.' }
    npm.cmd run prisma:migrate:status
    if ($LASTEXITCODE -ne 0) { throw 'Migrações não estão sincronizadas.' }

    npm.cmd run prisma:generate
    if ($LASTEXITCODE -ne 0) { throw 'Geração falhou.' }
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Tipagem falhou; manter serviços parados.' }

    # Seleção explícita: não executar suites PostgreSQL antigas no principal.
    node -e "const fs=require('fs'),cp=require('child_process');const files=fs.readdirSync('tests').filter(f=>f.endsWith('.test.ts')&&!fs.readFileSync('tests/'+f,'utf8').includes('DATABASE_TESTS')).map(f=>'tests/'+f);const r=cp.spawnSync(process.execPath,['--import','tsx','--test',...files],{stdio:'inherit'});process.exit(r.status??1);"
    if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build falhou.' }

    # Preflight somente leitura, pelo administrador, sem HTTP ou worker.
    $env:AUCTION_TEMPORAL_MODE = 'UTC_V2'
    node --import tsx -e "const db=require('./src/lib/prisma');(async()=>{try{await db.connectDatabase();console.log('Preflight administrativo aprovado.');}catch{process.exitCode=1;console.error('Preflight recusado. Manter serviços parados.');}finally{await db.disconnectDatabase();}})();"
    if ($LASTEXITCODE -ne 0) { throw 'Preflight falhou.' }
} finally {
    $env:DATABASE_URL = $utcSavedUrl
    $env:AUCTION_TEMPORAL_MODE = $utcSavedMode
    Remove-Variable utcSavedUrl,utcSavedMode -ErrorAction SilentlyContinue
}
```

Confirmar também via pgAdmin: migração concluída; coluna/default/índice válidos; os nove leilões históricos (ou contagem do snapshot autorizado) agora LEGACY; prefixo dos 14 eventos e demais dados preservados. O preflight verifica integridade da cadeia, mas não substitui comparar dados históricos com a evidência prévia/backup.

O client regenerado pode revelar fixtures que ainda não declaram o novo campo obrigatório. Qualquer falha de typecheck exige correção e revalidação antes de iniciar serviços; não remover essa checagem para acelerar a virada. Não executar testes financeiros destrutivos contra o principal.

### C — Limpeza se A foi interrompido antes de B

```powershell
$env:DATABASE_URL = $utcSavedUrl
$env:AUCTION_TEMPORAL_MODE = $utcSavedMode
Remove-Variable utcSavedUrl,utcSavedMode -ErrorAction SilentlyContinue
```

Depois de B, a limpeza já terá ocorrido pelo finally. Fechar o terminal temporário também encerra seu ambiente. Nunca iniciar a API usando a URL administrativa.

## 3. Liberação somente da nova versão

Depois de migração, testes, build, preflight administrativo e histórico aprovados, e com todos os watchers/serviços antigos impedidos de reiniciar:

1. Preparar um terminal novo em `backend/`, sem DATABASE_URL administrativa. A aplicação deve usar a conexão original de `leiloes_app` do `.env`.
2. Nesse terminal, definir apenas o modo do processo, sem iniciar o servidor ainda:

```powershell
$env:AUCTION_TEMPORAL_MODE = 'UTC_V2'
```

3. No pgAdmin como `postgres`, confirmar novamente o destino e executar **somente com autorização de liberação**:

```sql
DO $release$
BEGIN
  IF current_database() <> 'sistema_leiloes'
     OR session_user <> 'postgres' OR current_user <> 'postgres'
  THEN RAISE EXCEPTION 'Conexão administrativa incorreta.';
  END IF;
  ALTER ROLE leiloes_app LOGIN;
END
$release$;
```

4. No terminal da aplicação, verificar acesso/UTC/auditoria com o papel real antes de abrir HTTP:

```powershell
node --import tsx -e "const db=require('./src/lib/prisma');(async()=>{try{await db.connectDatabase();console.log('Preflight da aplicação aprovado.');}catch{process.exitCode=1;console.error('Preflight recusado. Não iniciar serviços.');}finally{await db.disconnectDatabase();}})();"
if ($LASTEXITCODE -ne 0) { throw 'Interromper; recolocar barreira administrativa.' }
npm.cmd start
```

O bootstrap repetirá o preflight. Iniciar apenas essa versão compilada; não usar um watcher antigo. Verificar saúde, consultas históricas e bloqueios LEGACY antes de qualquer nova escrita financeira. Abertura, lance, reserva, extensão, encerramento e captura deverão ser validados por canários específicos e autorizados, sem apagar ou modificar o histórico existente.

## Recuperação / interrupção

- Antes da migração: se qualquer gate falhar, limpar o ambiente temporário, manter NOLOGIN e serviços parados. Corrigir a causa; renovar o backup se houve novas escritas.
- Durante a migração: em erro/timeout, manter a barreira e inspecionar transação e `_prisma_migrations` somente por leitura. Não repetir cegamente, usar reset/db push ou marcar migração aplicada sem revisar. O DDL é transacional, mas a conclusão precisa ser comprovada.
- Depois da migração, antes da liberação: erro de geração/tipos/testes/build/preflight mantém a manutenção. Corrigir o artefato adiante; não remover a coluna ou regravar hashes como atalho.
- Se a liberação já ocorreu e o preflight/execução falhar: parar a nova instância, aplicar `ALTER ROLE leiloes_app NOLOGIN;` pela conexão administrativa correta e tratar somente suas sessões identificadas. Não reabrir um gravador antigo. LOGIN não desfaz nem confirma transações financeiras.
- Não há restauração automática. O backup tem legibilidade verificada, mas restauração funcional não testada. Restaurar sobre o principal exige nova autorização, plano de roles/permissões e reconciliação de qualquer escrita posterior ao backup; poderia perder operações já confirmadas.
- Depois do primeiro evento v2, o gravador antigo não é opção de rollback. Preservar a cadeia e corrigir adiante, com escrita suspensa enquanto houver inconsistência.

**Próxima ação:** obter autorização explícita para o passo 2. A preparação deste plano não concede essa autorização nem executa DDL, LOGIN, preflight UTC ou inicialização de serviços.
