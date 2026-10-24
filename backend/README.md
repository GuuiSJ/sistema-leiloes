# Backend — Sistema de Leilões

## Execução local

Na pasta `backend`, instale as dependências com `npm ci`, copie
`.env.example` para `.env` e execute `npm run dev`.

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
