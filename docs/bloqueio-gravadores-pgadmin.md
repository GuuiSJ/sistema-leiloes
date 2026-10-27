# Barreira de manutenção pelo pgAdmin — comandos preparados, não executados

## Identificação confirmada somente por leitura

- Backend: conexão autenticada como `leiloes_app` em `sistema_leiloes`.
- Worker: utiliza o mesmo singleton `getPrisma()` e a mesma DATABASE_URL do backend, portanto o mesmo papel neste ambiente. Não há credencial separada do worker no código atual.
- `leiloes_app`: LOGIN, não superusuário, sem CREATEROLE e sem REPLICATION; nenhuma associação de papéis encontrada, como membro ou como papel concedido.
- `postgres`: LOGIN e superusuário; proprietário de `sistema_leiloes`.
- Somente esses dois papéis LOGIN foram encontrados no cluster.
- Nenhuma outra sessão autenticada como `leiloes_app` foi encontrada no cluster naquele instante. Nenhuma transação preparada em `sistema_leiloes`.

Não foram lidas nem publicadas senhas. Não foi executado ALTER, GRANT, REVOKE, término de sessão ou mudança de configuração. A ausência de sessões não prova que um serviço não tentará reconectar.

## Escolha recomendada

Para este ambiente, usar **NOLOGIN somente em `leiloes_app`, seguido da drenagem/encerramento das sessões desse papel previamente identificadas**, mantendo `postgres` como conexão distinta de manutenção. Não conceder poderes administrativos ao papel da aplicação.

NOLOGIN afeta esse papel no cluster inteiro, inclusive outros bancos. Se outro sistema reutilizar `leiloes_app`, ele também ficará sem novas conexões. As consultas abaixo detectam uso presente, mas não provam ausência de uso intermitente. Confirmar operacionalmente que esse papel é exclusivo do sistema de leilões. Se não for, interromper e definir uma barreira restrita ao banco, como regra `pg_hba.conf` revisada; não aplicar o bloqueio global às cegas.

Somente `postgres` e `leiloes_app` podem autenticar no estado observado, e não há associações ao papel da aplicação. A barreira cobre os gravadores autenticados como `leiloes_app`; não impede que um superusuário escreva. Durante a janela, `postgres` deve ser usado exclusivamente pelo operador de manutenção, sem outro serviço automatizado usando suas credenciais. Não é possível prometer imutabilidade contra um administrador que deliberadamente a contorne.

## Privilégios

No pgAdmin, usar uma conexão autenticada **diretamente como `postgres`**, sem SET ROLE, e abrir o Query Tool em `sistema_leiloes`. A sessão e novas conexões administrativas de backup continuarão permitidas, pois o papel bloqueado será outro.

O superusuário confirmado possui os poderes necessários. Alternativamente, ALTER ROLE de um papel comum exige CREATEROLE e ADMIN OPTION sobre ele; sinalizar sessões requer associação apropriada ou `pg_signal_backend`, com restrições para sessões de superusuários. Não é necessário montar essa delegação para a manutenção local: utilizar o `postgres` já existente.

Referências: [ALTER ROLE PostgreSQL 17](https://www.postgresql.org/docs/17/sql-alterrole.html), [sinalização de sessões](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL).

## 1. Verificações no pgAdmin

Executar apenas esta seleção, inicialmente:

```sql
SELECT current_database(), session_user, current_user,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario;

SELECT rolname, rolcanlogin, rolsuper, rolreplication
FROM pg_roles
WHERE rolname IN ('postgres', 'leiloes_app');

SELECT pid, datname, usename, application_name, client_addr,
       state, backend_start, xact_start
FROM pg_stat_activity
WHERE usename = 'leiloes_app'
ORDER BY datname, pid;

SELECT member.rolname AS membro, parent.rolname AS papel,
       m.admin_option, m.inherit_option, m.set_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE member.rolname = 'leiloes_app' OR parent.rolname = 'leiloes_app';

SELECT gid, owner, prepared
FROM pg_prepared_xacts
WHERE database = 'sistema_leiloes';

SELECT pid, usename, application_name, client_addr, state
FROM pg_stat_activity
WHERE datname = 'sistema_leiloes' AND pid <> pg_backend_pid();
```

Exigir banco `sistema_leiloes`, session_user/current_user `postgres` e superusuario=true. Identificar a função de cada sessão. Se houver outro sistema usando `leiloes_app`, associações inesperadas, uma transação preparada ou outro gravador, parar antes do bloqueio. Não executar COMMIT PREPARED/ROLLBACK PREPARED nem encerrar sessões desconhecidas.

## 2. Bloquear novas conexões

Somente após aprovação, executar **este bloco separado**, concluindo o COMMIT antes de encerrar sessões:

```sql
BEGIN;
DO $maintenance$
BEGIN
  IF current_database() <> 'sistema_leiloes'
     OR session_user <> 'postgres'
     OR current_user <> 'postgres'
     OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  THEN
    RAISE EXCEPTION 'Conexão de manutenção incorreta; nenhuma alteração aplicada.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leiloes_app'
                 AND rolcanlogin AND NOT rolsuper AND NOT rolreplication)
  THEN
    RAISE EXCEPTION 'Estado inesperado do papel da aplicação; revisar antes de prosseguir.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_stat_activity
             WHERE usename = 'leiloes_app'
               AND datname IS DISTINCT FROM 'sistema_leiloes')
     OR EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database = 'sistema_leiloes')
  THEN
    RAISE EXCEPTION 'Papel em outro banco ou transação preparada; interromper.';
  END IF;

  ALTER ROLE leiloes_app NOLOGIN;
END
$maintenance$;
COMMIT;
```

Em caso de erro, executar apenas `ROLLBACK;` se a transação tiver ficado aberta. Não prosseguir com o término de sessões. O bloco não substitui a confirmação humana sobre sistemas que compartilhem o papel.

Conferir em nova seleção:

```sql
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'leiloes_app';
```

Esperado: `false`. Abrir um segundo Query Tool autenticado como `postgres` confirma que a manutenção continua disponível. Uma tentativa nova com `leiloes_app` deve ser recusada; não reabilitar LOGIN para realizar esse teste.

## 3. Tratar conexões abertas

NOLOGIN não encerra sessões existentes. Primeiro parar graciosamente API e workers já identificados e aguardar transações concluírem. Repetir a listagem do passo 1. Somente se as sessões restantes em `sistema_leiloes`/`leiloes_app` tiverem sido identificadas como pertencentes à aplicação e estiverem autorizadas para encerramento, executar:

```sql
SELECT pid, pg_terminate_backend(pid, 5000) AS encerrada
FROM pg_stat_activity
WHERE datname = 'sistema_leiloes'
  AND usename = 'leiloes_app'
  AND pid <> pg_backend_pid()
  AND backend_type = 'client backend';
```

Isso não encerra processos Windows. Sessões encerradas perdem operações não confirmadas, que sofrem rollback; não desfaz operações já confirmadas. Por isso, preferir drenagem limpa e nunca terminar uma transação financeira desconhecida.

Conferir novamente, depois do COMMIT do bloqueio e do término:

```sql
SELECT pid, datname, usename, state
FROM pg_stat_activity
WHERE usename = 'leiloes_app';
```

Esperado: zero linhas. Examinar também todas as demais sessões do banco, conforme passo 1: apenas manutenção/backup previamente reconhecidos podem permanecer. Conexões que completaram autenticação durante a aplicação do bloqueio também precisam desaparecer. Repetir após a tentativa controlada de reconexão e verificar que o papel continua NOLOGIN.

Um watcher como `tsx watch`, serviço ou tarefa pode continuar tentando reiniciar; não conseguirá autenticar como `leiloes_app` enquanto NOLOGIN permanecer. Ainda assim, parar seu mecanismo de reinício antes de reabrir LOGIN, para não liberar uma versão antiga no fim da janela.

## 4. Renovar o backup com o bloqueio mantido

O script `backup-temporal-preflight.ts` atual autentica como `leiloes_app`: **não funcionará enquanto o papel estiver NOLOGIN**. Não retirar a barreira para utilizá-lo.

No pgAdmin autenticado como `postgres`:

1. Conferir novamente NOLOGIN, zero sessões da aplicação, zero OPEN/ACTIVE e a auditoria. Não confundir isso com a proibição de escritas administrativas: manter os demais operadores/automação administrativa fora da janela.
2. Em `sistema_leiloes` → **Backup**, selecionar formato **Custom**, nome novo com data/hora dentro de `C:\Users\djesu\sistema-leiloes\backups\`, todos os schemas/tabelas e seções **Pre-data, Data e Post-data**. Não ativar filtros “Only schema”/“Only data”, não excluir owners/privileges; incluir a definição de criação do banco se desejado para recuperação completa. Nenhuma senha deve ser colocada em comandos ou documentação.
3. Exigir código de saída 0 e analisar avisos. Se o pgAdmin não conseguir executar o utilitário ou acessar a pasta, manter NOLOGIN e resolver o problema; não prosseguir sem novo backup validado.
4. Em PowerShell, verificar o arquivo novo sem restaurar:

```powershell
# Substituir apenas pelo caminho do novo arquivo efetivamente produzido.
$maintenanceDump = 'C:\Users\djesu\sistema-leiloes\backups\NOME_DO_NOVO_BACKUP.dump'
if (-not (Test-Path -LiteralPath $maintenanceDump -PathType Leaf)) { throw 'Backup não encontrado.' }
if ((Get-Item -LiteralPath $maintenanceDump).Length -le 0) { throw 'Backup vazio.' }
& 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe' --list $maintenanceDump
if ($LASTEXITCODE -ne 0) { throw 'Listagem falhou.' }
& 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe' --file=NUL $maintenanceDump
if ($LASTEXITCODE -ne 0) { throw 'Leitura completa falhou.' }
$maintenanceHash = (Get-FileHash -LiteralPath $maintenanceDump -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($maintenanceDump + '.sha256') -Encoding ascii -Value ($maintenanceHash + '  ' + (Split-Path -Leaf $maintenanceDump))
```

Registrar tamanho, checksum e horários. Continuar sem restauração sobre o principal. Listar e descomprimir não comprovam restauração funcional: esse ensaio continua pendente. Roles globais e suas senhas não são incluídas por pg_dump.

Manter o bloqueio durante a migração futura; ela e as verificações necessárias deverão usar uma conexão administrativa distinta aprovada, não o papel NOLOGIN. Não executar a migração nesta etapa.

## 5. Reversão

O estado observado anteriormente era LOGIN. Se apenas este bloqueio foi aplicado, o comando correspondente é o seguinte, em conexão administrativa `postgres`:

```sql
BEGIN;
DO $maintenance$
BEGIN
  IF current_database() <> 'sistema_leiloes'
     OR session_user <> 'postgres' OR current_user <> 'postgres'
  THEN
    RAISE EXCEPTION 'Conexão de manutenção incorreta.';
  END IF;
  ALTER ROLE leiloes_app LOGIN;
END
$maintenance$;
COMMIT;

SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'leiloes_app';
```

Esse comando não muda senha, ACL, memberships ou dados e não reinicia processos. Encerramento de sessão não tem “desfazer”: o cliente precisa reconectar; alterações não confirmadas não devem ser reenviadas indiscriminadamente.

Executar a reversão somente após decisão do operador: em cancelamento da manutenção, avaliar o estado antes de reabrir; após a virada temporal, permitir LOGIN apenas quando os gravadores antigos estiverem desativados e exclusivamente a versão corrigida for iniciada. Reabrir LOGIN cedo permitiria reconexão dos watchers antigos.

## Alternativas avaliadas

- `REVOKE CONNECT ... FROM leiloes_app` isoladamente pode não bloquear conexões por grants a PUBLIC ou por associações. Para ser eficaz exigiria inventariar e preservar ACLs, possivelmente afetando outros usuários; não é mais simples aqui.
- `ALTER DATABASE ... ALLOW_CONNECTIONS false` impede também novas conexões administrativas de backup e de ferramentas de migração. Uma sessão existente pode permanecer, mas perdê-la complica a manutenção. Não recomendado para este fluxo. [ALTER DATABASE](https://www.postgresql.org/docs/17/sql-alterdatabase.html).
- `default_transaction_read_only=on` é um default de sessão, não uma barreira administrativa eficaz contra um cliente capaz de mudá-lo. Não utilizá-lo como substituto.
- Parar o serviço PostgreSQL impediria todos os acessos, inclusive backup/migração; não resolve a janela de manutenção online.
- Uma regra `pg_hba.conf` restrita a banco/papel pode ser adequada se o papel for compartilhado, mas exige revisão da ordem das regras e preservação do acesso administrativo. Não é a opção mais simples para o papel dedicado identificado.

**Decisão proposta:** confirmar a exclusividade de `leiloes_app`, manter pgAdmin como `postgres`, aprovar NOLOGIN e tratar somente sessões identificadas. Nenhum desses comandos de alteração foi executado pelo assistente.
