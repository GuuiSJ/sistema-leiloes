# Deploy de avaliação: Render + Neon + frontend estático

Este é um roteiro para execução futura pelo responsável. **Nenhum deploy, criação/importação de dados ou migração foi executado na preparação desta documentação.** URLs abaixo são placeholders; substitua os nomes de serviço pelos escolhidos no painel. Não coloque segredos no repositório.

## 1. Configuração planejada

| Serviço | Tipo / plano | Diretório raiz | Build | Start / publicação |
| --- | --- | --- | --- | --- |
| API | Render Web Service / Free / Node | `backend` | `npm ci --include=dev && npm run build` | `npm start` |
| Interface | Render Static Site / gratuito | `frontend` | `npm ci --include=dev && npm run build` | diretório `dist` |
| Banco | Projeto Neon / plano gratuito disponível na conta | — | etapa administrativa separada | PostgreSQL direto com TLS |

Conecte o repositório e selecione a branch `main` pelo painel; este procedimento não executa comandos Git. Escolha regiões próximas para API e banco. Confirme os limites gratuitos exibidos na conta antes de criar os serviços. [Tipos gratuitos da Render](https://render.com/docs/free), [hospedagem estática](https://render.com/docs/static-sites).

Configure `NODE_VERSION=24.18.0` nos dois serviços, a versão verificada localmente. O repositório também contém `.node-version`. Não depender do Node padrão da plataforma. [Seleção da versão Node](https://render.com/docs/node-version).

## 2. Variáveis de produção

### Backend — segredos e configuração no painel Render

| Variável | Valor / regra |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Segredo: URL direta do Neon, com TLS; nunca versionar |
| `JWT_SECRET` | Segredo exclusivo e aleatório com pelo menos 32 bytes; não reutilizar o local |
| `JWT_EXPIRES_IN` | `3600`, em segundos |
| `FRONTEND_URL` | Origem HTTPS exata do Static Site, por exemplo `https://NOME-DO-FRONTEND.onrender.com`, sem barra final ou caminho |
| `AUCTION_TEMPORAL_MODE` | `UTC_V2` |
| `ENABLE_SIMULATED_CREDITS` | `false` |
| `ENABLE_PRODUCTION_DEMO_CREDITS` | `false` por padrão; `true` somente para avaliação controlada |
| `PRODUCTION_DEMO_CREDIT_USER_IDS` | Lista privada de UUIDs de contas BIDDER fictícias autorizadas, separados por vírgula; vazia bloqueia |
| `PRODUCTION_DEMO_CREDIT_LIMIT` | Teto acumulado por conta, por exemplo `1000.00`; obrigatório no modo de demonstração |
| `NODE_VERSION` | `24.18.0`, seleção do runtime/build Render |
| `PORT` | Deixar a Render fornecer; o servidor já usa essa variável e escuta sem fixar localhost |

Opcionalmente `TZ=UTC` para ferramentas/processo Node; isso **não substitui** o pool PostgreSQL com TimeZone UTC e o preflight implementados. Não criar variáveis de seed, administrador ou saldo que o código não suporta.

### Frontend — variável pública de build

`VITE_API_URL=https://NOME-DA-API.onrender.com`, sem `/api` e sem barra final. É a mesma origem para HTTP e Socket.IO. A aplicação já acrescenta `/api` aos endpoints.

`VITE_*` entra no JavaScript público. Nunca colocar conexão do banco, segredo JWT, token de usuário ou senha nessas variáveis. Alterar `VITE_API_URL` exige novo build do frontend.

## 3. Neon e Prisma 7

1. Crie o projeto Neon e uma base vazia dedicada à demonstração. Guarde a conexão administrativa em local privado.
2. Em **Connect**, escolha conexão **direta, não pooled**. Este projeto depende de configuração de sessão UTC, verificação de epochs e transações/locks; não trocar para pooler sem validar esse contrato. Use conexão direta também para dump, restore e migrações. [Neon: conexão e pooling](https://neon.com/docs/connect/connection-pooling).
3. Preserve TLS na URL fornecida pelo Neon, incluindo `sslmode` e demais parâmetros de segurança compatíveis com o driver. Não desabilite validação de certificado. Não inserir `options`, `timezone` ou `tz` na URL: o backend rejeita esses overrides e configura UTC pelo adapter. [Conexões Neon](https://neon.com/docs/connect/connection-errors), [TLS no node-postgres](https://node-postgres.com/features/ssl).
4. O Prisma 7 usa `prisma.config.ts` para a URL e gera o client em `src/generated/prisma`; o runtime usa `@prisma/adapter-pg`. O build foi ajustado para `prisma generate && tsc`, pois o client gerado não está versionado. Instalar devDependencies durante o build é necessário para Prisma CLI e TypeScript.
5. Escolha **um** caminho para preparar o banco, sem misturar os dois:
   - **Base fictícia completa restaurada**, recomendada para contas com saldo e histórico: seguir a seção de dados abaixo. O dump inclui schema e `_prisma_migrations`; não rodar migrações antes da restauração.
   - **Banco totalmente novo, sem demonstração**: numa etapa administrativa autorizada, com `DATABASE_URL` apontando explicitamente para esse Neon vazio, executar em `backend/` `npm run prisma:migrate:deploy`. Isso cria schema e histórico de migrações, mas não cria contas, saldos ou leilões. Esse caminho não substitui o preparo das contas de avaliação.

Não incluir `prisma migrate deploy`, `db push`, `migrate reset` ou restore no build/start da Render. Não reaplicar procedimentos históricos de conversão temporal sobre dados UTC já preparados. Um banco existente ou de procedência incerta exige avaliação específica antes de qualquer alteração.

Antes de ativar a API, o schema deve ter as quatro migrações do repositório, `AuctionTemporalGeneration`, os 20 campos temporais esperados como `timestamptz(3)`, nenhuma operação LEGACY ativa impeditiva e cadeia de auditoria válida. O bootstrap verifica esses requisitos e bloqueia HTTP/worker se falharem; não resolve problemas alterando hashes ou promovendo LEGACY.

Para verificar o destino previamente **sem iniciar servidor/worker**, em `backend/` com build pronto e as variáveis do destino definidas no processo, usar:

```sh
node -e 'if (!process.env.DATABASE_URL || process.env.AUCTION_TEMPORAL_MODE !== "UTC_V2") throw Error("Defina explicitamente o destino e UTC_V2 no processo"); const {PrismaClient}=require("./dist/generated/prisma/client"); const {PrismaPg}=require("@prisma/adapter-pg"); const {temporalPoolConfig}=require("./dist/config/temporal"); const {TemporalRuntime}=require("./dist/modules/temporal/temporal-runtime"); const config=temporalPoolConfig(process.env.DATABASE_URL,"UTC_V2"); const db=new PrismaClient({adapter:new PrismaPg({...config,options:config.options+" -c default_transaction_read_only=on",max:2}),log:[],errorFormat:"minimal"}); new TemporalRuntime("UTC_V2").verify(db).then(()=>console.log("Preflight UTC_V2 aprovado, somente leitura")).catch(e=>{console.error("Preflight bloqueado:",e.code||"VERIFICACAO_FALHOU");process.exitCode=1}).finally(()=>db.$disconnect());'
```

O comando é para shell POSIX; no PowerShell, passar o mesmo texto JavaScript por here-string para `node -`. Não imprima `DATABASE_URL` ao preparar o ambiente. O script antigo `run-app-preflight-utc.ps1` é limitado ao banco local e não deve ser usado como preflight Neon.

## 4. Render — API

1. Crie **Web Service**, runtime Node, branch `main`, Root Directory `backend`, plano **Free**.
2. Cadastre as variáveis da tabela antes do build. Build Command: `npm ci --include=dev && npm run build`. Start Command: `npm start`. Health Check Path: `/api/health`.
3. O banco deve estar preparado antes de iniciar o serviço. Não usar o início do backend para carregar demonstrações: ele também inicia o worker e pode processar registros elegíveis.
4. Consulte os logs: o HTTP só sobe depois do preflight. Devem aparecer a porta e `Processamento automático UTC_V2 iniciado: abertura e encerramento a cada segundo.`
5. Verifique `GET https://NOME-DA-API.onrender.com/api/health`: status `ok` e metadado `temporal.representation = STORED_UTC_INSTANT`. Isso comprova startup, não uma validação financeira completa do deploy.

Express e Socket.IO usam o mesmo servidor/porta; não configurar uma segunda porta de WebSocket nem outro processo de worker. Manter uma única instância para a avaliação: fila/eventos Socket.IO são locais ao processo e não há adapter distribuído configurado. [WebSockets na Render](https://render.com/docs/websocket).

## 5. Render — frontend estático gratuito

1. Crie **Static Site** no mesmo repositório, branch `main`, Root Directory `frontend`.
2. Configure `NODE_VERSION=24.18.0` e `VITE_API_URL` com a URL HTTPS da API.
3. Build Command: `npm ci --include=dev && npm run build`. Publish Directory: `dist`.
4. Em **Redirects/Rewrites**, cadastre **Source `/*` → Destination `/index.html` → Action Rewrite** (não Redirect). As rotas de Minha conta, lotes, comprovantes e auditoria precisam funcionar ao abrir um link direto ou atualizar a página. [Rewrite SPA](https://render.com/docs/deploy-create-react-app#using-client-side-routing), [Vite em hospedagem estática](https://vite.dev/guide/static-deploy).
5. Com a origem final do site, atualize `FRONTEND_URL` no backend e reinicie/republique a API. Se os URLs ainda não existirem, reserve/crie os serviços e complete as duas configurações antes da avaliação.

## 6. CORS, autenticação e tempo real

- `frontendOrigin()` é compartilhado pelo CORS Express e Socket.IO; aceita uma origem configurada. Não usar `*`, lista separada por vírgulas, URL com caminho ou barra final.
- O JWT é enviado em `Authorization: Bearer`, sem cookies. O middleware CORS permite o preflight dos headers necessários, incluindo `Idempotency-Key`.
- Socket.IO usa a origem HTTPS da API (WSS quando transportado por WebSocket), sem token nas notificações públicas. A origem do navegador também é validada no handshake WebSocket. Domínios de preview diferentes não são liberados automaticamente.
- Mudança de configuração exige reiniciar o backend. Não definir `NODE_ENV=development` na Render para liberar crédito. A flag local `ENABLE_SIMULATED_CREDITS` não libera produção.

## Créditos simulados controlados na Render

1. Mantenha `NODE_ENV=production` e `ENABLE_SIMULATED_CREDITS=false`.
2. Escolha contas **BIDDER exclusivamente fictícias** e obtenha seus UUIDs pela resposta autenticada de `/api/auth/me`. Confira a identidade de cada conta; não autorize usuários comuns, nem use e-mails, curingas ou IDs enviados pelo frontend.
3. Em Environment da API, configure `ENABLE_PRODUCTION_DEMO_CREDITS=true`, `PRODUCTION_DEMO_CREDIT_USER_IDS=UUID_DA_CONTA_1,UUID_DA_CONTA_2` e `PRODUCTION_DEMO_CREDIT_LIMIT=1000.00` (substitua os placeholders por UUIDs válidos; valor em reais, ponto e duas casas). Reinicie a API pelo procedimento normal da Render. Não coloque essas configurações em variáveis `VITE_*`.
4. Com o frontend atualizado, entre na conta autorizada → Minha conta → Carteira virtual → Consultar carteira → Adicionar saldo. Informe o valor, revise e confirme. O frontend consulta `GET /api/wallet/credit-capability` com JWT; conta não autorizada não recebe formulário. `POST /api/wallet/credit` revalida permissão, valor e chave de idempotência independentemente da interface.
5. O teto considera a soma histórica de movimentos `CREDIT` identificados como `demo-credit:`, inclusive créditos locais importados. Gastar saldo, reiniciar a API ou repetir uma operação não renova o limite. A verificação ocorre sob o lock da carteira, na transação serializável. A repetição confirmada da mesma chave/valor retorna o movimento existente sem novo crédito; outra quantia com a mesma chave é conflito.
6. Para encerrar a avaliação, defina `ENABLE_PRODUCTION_DEMO_CREDITS=false` e reinicie. Uma configuração ausente/inválida ou retirada da lista bloqueia novos envios, inclusive tentativas pendentes; consulte o histórico dessas tentativas antes de qualquer nova operação. Não aumente o teto automaticamente.

Não há depósito, pagamento, saque ou dinheiro real. Este modo deve ser usado somente em uma instância com dados fictícios. A lista autoriza IDs explicitamente; ela não detecta por si só se uma conta pertence a uma pessoa real. Não compartilhe senhas ou tokens no README. Contas fora da lista seguem bloqueadas, mesmo com a flag ligada.

## Dados de demonstração

Não existe seed remoto implementado. A forma disponível sem ampliar permissões de produção é **preparar uma base exclusivamente fictícia, exportar e restaurar uma vez em um Neon novo e vazio**, com API/worker de destino ainda desligados.

1. O responsável deve preparar um PostgreSQL local isolado, sem contas pessoais nem dados reais. Usar outra instância/porta para não confundir com o banco atual. As proteções locais exigem nome `sistema_leiloes`; confirmar host, porta, banco e identidade antes de qualquer operação.
2. Em etapa manual autorizada nessa base isolada: criar contas fictícias pela aplicação, promover a conta de leiloeiro com o script interativo existente e conceder saldo de demonstração pela interface local autorizada. Somente esse ambiente local pode ter `ENABLE_SIMULATED_CREDITS=true`; o destino remoto permanece `production`/`false`.
3. Preparar histórico fictício por fluxos normais de lances e encerramento, se desejado; não inserir bids, comprovantes ou saldos por SQL avulso. Interromper os gravadores antes do snapshot. Histórico concluído e contas com saldo são adequados ao dump; para sala ao vivo, criar um leilão com datas futuras pela aplicação publicada depois da importação. Não deslocar datas assinadas, recalcular hashes, retaggear LEGACY ou apagar reservas para simular consistência.
4. Exportar **toda** a base de demonstração preparada, preservando IDs, relacionamentos, saldos, movimentos, reservas, comprovantes, cadeia de auditoria, sequências e `_prisma_migrations`. Não copiar a base real de uso pessoal nem publicar o dump. Compartilhar credenciais das contas fictícias somente no canal privado de avaliação, fora do README.
5. Restaurar somente em banco Neon vazio, sem API/worker conectados. Usar conexão administrativa direta para importação; depois configurar uma credencial de aplicação com privilégios necessários, sem liberar DDL indiscriminado. Guardar ambas como segredos e limitar o acesso ao projeto Neon.

Os comandos abaixo são **administrativos futuros, não executados nesta entrega**. `DEMO_SOURCE_URL` e `DEMO_TARGET_URL` devem vir de armazenamento privado no processo; nunca substituir por credenciais no README. Utilizar cliente PostgreSQL compatível com a versão do servidor e conexão direta. [Neon: dump e restauração](https://neon.com/docs/import/migrate-from-postgres).

Os exemplos `sh` usam Linux/macOS/WSL. No PowerShell, referenciar essas variáveis como `$env:DEMO_SOURCE_URL` e `$env:DEMO_TARGET_URL`, e usar os executáveis PostgreSQL instalados no PATH. Não imprimir as variáveis nem salvar seus valores em arquivos versionados.

```sh
# Destino precisa retornar zero tabelas públicas antes da importação. Caso contrário, parar.
psql "$DEMO_TARGET_URL" -X -A -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"

# Somente origem fictícia previamente validada e sem gravadores.
pg_dump --format=custom --no-owner --no-acl --file=demo.dump "$DEMO_SOURCE_URL"

# Não usar --clean nem sobrescrever uma base já utilizada.
pg_restore --no-owner --no-acl --single-transaction --exit-on-error --dbname="$DEMO_TARGET_URL" demo.dump
```

Não executar migrações depois do restore como tentativa automática de correção. Primeiro conferir schema, migrações e preflight. Não importar subconjuntos isolados de carteiras/lances sem plano de integridade. Um dump antigo não se torna atual apenas por existir em `backups/`; os backups históricos locais não são seeds de produção aprovados.

Contas públicas novas continuarão sem saldo e sem botão de crédito. Avaliadores podem usar contas fictícias previamente financiadas ou os IDs explicitamente autorizados no modo acima; não há reposição ilimitada de créditos em produção. Não é necessário importar uma base apenas para disponibilizar créditos controlados.

## 7. Suspensão gratuita e worker

A Render Free suspende o serviço após 15 minutos sem HTTP ou mensagens WebSocket recebidos. O retorno pode levar cerca de um minuto e perde conexões; o frontend precisa reconectar. O worker no mesmo processo também fica suspenso: abertura/encerramento não têm garantia de pontualidade nesse plano. [Limitações Free](https://render.com/docs/free), [tráfego WebSocket e suspensão](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages).

Se a API voltar ainda dentro do período válido, o worker pode abrir um agendado atrasado; se o término já passou, a abertura é recusada pelas regras existentes. Lotes OPEN vencidos são reavaliados na retomada pelo encerramento existente. O Neon também pode ter latência de retomada e limites do plano; conferir o painel. Para a apresentação, abrir a API antes, aguardar saúde/UTC e manter a sessão de demonstração ativa. Não prometer disponibilidade contínua nem criar um segundo agendador para esconder essa limitação; operação sem suspensão exige infraestrutura apropriada.

## 8. Verificação final pelo responsável

Após publicação, conferir HTTPS, login das contas fictícias, bloqueio de créditos públicos, links diretos SPA, CORS, inscrição/reconexão Socket.IO e leitura de carteira/histórico. Verificar um leilão futuro por Rascunho → Agendado → Ao vivo e seu resultado somente na janela de demonstração autorizada. Não confundir mocks locais com validação no domínio público. Guardar URLs finais para a submissão e enviar as contas de avaliação privadamente.

Na preparação local passaram: build backend com geração Prisma 7.10.1, build frontend, typecheck de ambos, `prisma validate`, 69 testes de ativação UTC/carteira sem banco e conferência dos links locais do README/guia. O build frontend conserva o aviso de bundle acima de 500 kB; não foi feita refatoração para dividir código. `npm start` não foi executado nesta preparação, para não acionar o worker contra registros existentes. Nenhuma conexão Neon ou domínio Render real foi validado nesta etapa.
