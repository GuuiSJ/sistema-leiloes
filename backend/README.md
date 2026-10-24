# Backend — Sistema de Leilões

## Gerenciamento de leilões

API pública de listagem/consulta e criação, edição e cancelamento restritos ao
leiloeiro responsável: [`docs/gerenciamento-leiloes.md`](../docs/gerenciamento-leiloes.md).
O documento inclui regras, paginação e exemplos Postman. Nenhuma variável de
ambiente adicional é necessária além da configuração de autenticação e banco.

## Autenticação

Cadastro público de arrematantes, login JWT e consulta do usuário autenticado:
[`docs/autenticacao.md`](../docs/autenticacao.md). Configure `JWT_SECRET`
(pelo menos 32 bytes aleatórios) e `JWT_EXPIRES_IN` (segundos, padrão `3600`)
no `.env` antes de iniciar a API. Cadastro público de leiloeiros é bloqueado.
Execute `npm test` para os testes automatizados de autenticação.

## Execução local

Na pasta `backend`, instale as dependências com `npm ci`, copie
`.env.example` para `.env`, configure `DATABASE_URL` com os dados reais de um
PostgreSQL acessível e execute `npm run prisma:generate` e `npm run dev`.

- `npm run dev`: servidor com reinício automático via tsx.
- `npm run typecheck`: verificação rigorosa de tipos.
- `npm run build`: compilação para `dist`.
- `npm start`: execução da versão compilada (após o build).

O arquivo `.env` permite configurar `PORT` (padrão: `3000`), `NODE_ENV`
e `FRONTEND_URL` (origem permitida pelo CORS; padrão: `http://localhost:5173`).

## Rota de saúde

`GET http://localhost:3000/api/health` retorna HTTP 200:

```json
{
  "status": "ok",
  "message": "API do Sistema de Leilões funcionando!"
}
```

Rotas inexistentes retornam HTTP 404 em JSON. O middleware centralizado
trata erros, incluindo JSON inválido (HTTP 400), e oculta detalhes de
erros internos (HTTP 500).

`src/app.ts` configura o Express e os middlewares; `src/server.ts` inicia
o servidor; `src/routes` concentra as rotas; `src/middlewares` contém
os tratamentos de erros e de rotas inexistentes.

## PostgreSQL e Prisma

Prisma CLI, Client e adaptador PostgreSQL estão fixados em `7.10.1`.
O Node.js validado neste projeto é `24.18.0`, compatível com essa versão.
O projeto mantém CommonJS; o gerador `prisma-client` usa `moduleFormat = "cjs"`.

`prisma/schema.prisma` configura PostgreSQL e os modelos iniciais do domínio.
As relações, decisões e limites da modelagem estão em
[`docs/modelagem-banco.md`](../docs/modelagem-banco.md). Os modelos somente serão
criados no banco após aprovação e execução de uma migração.
`prisma.config.ts` carrega o ambiente e informa a conexão à CLI.
`src/lib/prisma.ts` disponibiliza uma única instância pelo método `getPrisma()`.
O client gerado em `src/generated/prisma` é ignorado pelo Git e deve ser
gerado após instalar as dependências e após mudanças no schema.

`DATABASE_URL` segue o formato mostrado em `.env.example`, que contém somente
valores fictícios. Substitua usuário, senha, host, porta e nome do banco pelos
valores reais. Caracteres especiais nas credenciais devem ser codificados para URL.
Não versione `.env` nem publique a URL em logs.

O carregamento é centralizado em `src/config/env.ts`, com caminho explícito
para `backend/.env`, tanto no código TypeScript quanto no compilado. Variáveis
já definidas no processo têm prioridade. Se `DATABASE_URL` estiver vazia,
preencha-a localmente com a URL de conexão; o arquivo não deve ser compartilhado.

O PostgreSQL deve estar instalado e em execução, com banco e usuário autorizados
previamente configurados. Esta etapa não instala serviços, cria bancos ou tabelas.

Comandos na pasta `backend`:

- `npm run prisma:validate`: valida o schema sem conectar ao banco.
- `npm run prisma:generate`: gera o client sem conectar ao banco.
- `npm run db:check`: verifica conexão com `SELECT 1`, sem alterar dados.
- `npm run prisma:migrate:status`: consulta o estado das migrações.
- `npm run prisma:migrate:dev -- --name nome_em_portugues`: cria/aplica migrações
  de desenvolvimento; reservado para uma próxima etapa autorizada.
- `npm run prisma:migrate:deploy`: aplica migrações existentes; executar somente
  quando houver migrações revisadas e autorização para alterar o banco.

A migração `20261024111646_init_modelagem` está preparada em `prisma/migrations`,
mas não foi aplicada. Após aprovação, `npm run prisma:migrate:deploy` aplica
as migrações pendentes. Consulte a documentação da modelagem antes de executar.
Validação e geração podem ser feitas sem `DATABASE_URL`; comandos de conexão e
migração exigem uma URL válida.

Ao iniciar, a API conecta ao banco e executa `SELECT 1` antes de abrir a porta HTTP.
Se faltar configuração ou a conexão falhar, encerra com código de erro e mensagem
genérica, sem exibir credenciais. `GET /api/health` continua sendo uma rota de
saúde HTTP, sem consultar o banco a cada chamada.

Em `SIGINT`/`SIGTERM`, o servidor para de aceitar requisições, aguarda as conexões
HTTP por até dez segundos e desconecta o Prisma. O pool tem timeout de conexão
de cinco segundos.
