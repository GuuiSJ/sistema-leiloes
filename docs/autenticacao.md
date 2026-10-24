# Autenticação inicial

Endpoints disponíveis sob `/api/auth`, sem refresh token, carteira ou alterações
de schema. Cadastro público permite somente `BIDDER`, em todos os ambientes.
A criação controlada de `AUCTIONEER` fica para uma etapa posterior.

## Ambiente e execução

Configure localmente `backend/.env`, preservando sua `DATABASE_URL`:

```ini
JWT_SECRET=
JWT_EXPIRES_IN=3600
```

Preencha `JWT_SECRET` com um segredo criptograficamente aleatório de pelo menos
32 bytes, gerado localmente. Não use o exemplo de senha do Postman como segredo,
não compartilhe esse valor e não versione `.env`. `JWT_EXPIRES_IN` é um inteiro
positivo em segundos (padrão: 3600); valores como `1h` não são aceitos.
Reinicie a API após modificar essas variáveis. A inicialização exige configuração
JWT válida e conexão com o banco.

Na pasta `backend`:

```powershell
npm.cmd run dev
```

## Postman

Defina `baseUrl` como `http://localhost:3000`. Nos POSTs, selecione Body → raw →
JSON (`Content-Type: application/json`). Os exemplos abaixo usam dados fictícios.

### Cadastro

`POST {{baseUrl}}/api/auth/register`

```json
{
  "name": "Pessoa Teste",
  "email": "pessoa@example.com",
  "password": "UmaSenhaDeTeste!2026",
  "role": "BIDDER"
}
```

Retorna HTTP 201 com `{ "user": { ... } }`. O usuário contém somente `id`,
`name`, `email`, `role` e `createdAt`. Nome é aparado; e-mail é aparado e convertido
para minúsculas. Senha não é aparada: seu conteúdo exato deve ser usado no login.

Validação: nome com 2–120 caracteres, e-mail com formato válido e até 254
caracteres, senha com pelo menos 8 caracteres e no máximo 72 bytes UTF-8, sem byte
nulo. O limite em bytes evita truncamento pelo bcrypt. Os campos extras são
rejeitados; não é possível enviar `passwordHash` ou definir campos internos.

E-mail duplicado retorna 409, dados inválidos retornam 400 e perfil `AUCTIONEER`
retorna 403. Senhas são processadas com bcrypt assíncrono, salt aleatório e custo 12.
A restrição única do banco também protege contra cadastros simultâneos.

### Login

`POST {{baseUrl}}/api/auth/login`

```json
{
  "email": "pessoa@example.com",
  "password": "UmaSenhaDeTeste!2026"
}
```

Retorna HTTP 200 com `user`, `accessToken`, `tokenType: "Bearer"` e `expiresIn`
em segundos. Credenciais inválidas retornam 401 com a mesma mensagem para e-mail
inexistente ou senha incorreta. Dados de entrada inválidos retornam 400.

Copie o `accessToken` apenas para uma variável local e privada do Postman,
chamada `accessToken`; não publique o token em coleções compartilhadas.

### Usuário atual

`GET {{baseUrl}}/api/auth/me`

Na aba Authorization, selecione Bearer Token e informe `{{accessToken}}`.
Não é necessário enviar body.

Retorna HTTP 200 com `{ "user": { ... } }`, usando a mesma seleção de campos
do cadastro. Token ausente, inválido, expirado ou de usuário inexistente retorna
401. Os endpoints de autenticação enviam `Cache-Control: no-store`.

O token é assinado com HS256, com emissor e audiência fixos, identificação do
usuário em `sub`, expiração e identificador único. Não inclui e-mail, senha ou
perfil. A verificação restringe algoritmo, emissor e audiência e exige expiração.

## Uso dos middlewares

`authenticate` deve vir antes de `authorize`. O primeiro valida o JWT e consulta
o usuário atual no banco; o segundo utiliza esse perfil atualizado, sem confiar
em um papel informado pelo token. Exemplo para uma futura rota, não implementada:

```ts
router.get("/rota-futura", authenticate, authorize("AUCTIONEER"), handler);
```

Retornos: 401 sem autenticação válida, 403 para perfil não permitido e 500 com
mensagem genérica em falhas internas. Logs não incluem corpo de requisição,
token, senha, hash ou detalhes do driver.

## Testes

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Os testes usam o executor nativo `node:test`, requisições HTTP reais, bcrypt e
jsonwebtoken reais e um repositório em memória. Não conectam ao PostgreSQL, não
criam usuários reais e não alteram `.env`. Rotas de teste para autorização existem
somente no processo dos testes, sem novos endpoints de negócio na API.

Cobrem cadastro, normalização e hash, duplicidade, conflito de unicidade simulado,
entrada inválida, limite do bcrypt, proibição de leiloeiro público, login,
credenciais incorretas, `/me`, assinatura/expiração/payload JWT, usuário inexistente,
perfil atualizado, falhas internas, configuração JWT e preservação de `/api/health`.

`npm run typecheck` também verifica os testes; `npm run build` compila somente
`src`, mantendo testes fora de `dist`.
