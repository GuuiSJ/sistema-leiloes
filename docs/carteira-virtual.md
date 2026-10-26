# Carteira virtual e créditos simulados

**Todos os créditos deste endpoint são simulados, exclusivos da demonstração local. Não representam dinheiro real, depósito, pagamento ou integração com instituição financeira.**

## Modelagem conferida

Implementação na branch `feat/sistema-lances`, sem alterar schema ou criar migrações:

- `User.wallet` é opcional; `Wallet.userId` é único, permitindo uma carteira por usuário, com FK restritiva.
- `Wallet.balance` é o saldo total, Decimal(18,2), padrão zero. `version` é inteiro usado internamente e incrementado a cada novo crédito.
- Não existem colunas de saldo reservado/disponível. Reservado = soma de `BidReservation.amount` com status ACTIVE; disponível = `balance - reservado`. Reservas RELEASED/CAPTURED não entram nessa soma.
- `WalletTransaction` registra `walletId`, `reservationId` opcional, `type`, `amount`, `balanceAfter`, `idempotencyKey` única globalmente (até 120 caracteres) e `createdAt`. Valores monetários são Decimal(18,2).
- `BidReservation` possui FKs compostas que conferem carteira/usuário e lance/lote/usuário, além de unicidades por carteira/lote e por lance. As relações financeiras são restritivas.

Esta etapa não cria lances, reservas, liquidação, transferências ou saques. Ler reservas existentes preserva compatibilidade com o schema. As fixtures de testes podem criar esses vínculos apenas para validar a consulta.

## Endpoints

Todos exigem `Authorization: Bearer <token>` e perfil atual **BIDDER**. O middleware existente consulta o usuário no banco; o papel enviado no token não define a autorização. O usuário vem exclusivamente da autenticação.

| Método | Endpoint | Sucesso |
|---|---|---|
| GET | `/api/wallet` | 200 com saldos próprios |
| POST | `/api/wallet/credit` | 201 no primeiro crédito; 200 no reenvio idempotente |
| GET | `/api/wallet/transactions` | 200 com histórico próprio paginado |

Não existem endpoints genéricos para alterar saldo, selecionar outra carteira, apagar movimentações ou depositar dinheiro real.

## Habilitação segura da demonstração

O crédito é **desabilitado por padrão**. São necessárias simultaneamente:

1. `NODE_ENV=development`, exatamente.
2. `ENABLE_SIMULATED_CREDITS=true`, exatamente.
3. A conexão já configurada em `DATABASE_URL` deve apontar para PostgreSQL no banco `/sistema_leiloes`, com host `localhost`, `127.0.0.1` ou `[::1]`, sem fragmento. Aceita ausência de parâmetros ou exclusivamente `?schema=public`. Outros parâmetros, parâmetros repetidos e schemas diferentes são rejeitados, incluindo opções que poderiam redirecionar host.

Produção, test, staging, ambiente ausente, flag ausente ou conexão remota bloqueiam crédito com **403**, antes de criar carteira ou lançar movimento. Em produção, habilitar somente a flag não libera o endpoint. Consultas continuam disponíveis ao BIDDER em outros ambientes.

Para experimentar localmente no PowerShell, sem modificar `.env`, execute na pasta `backend` usando a conexão local já configurada:

```powershell
$env:NODE_ENV = 'development'
$env:ENABLE_SIMULATED_CREDITS = 'true'
try { npm.cmd run dev } finally {
  Remove-Item Env:ENABLE_SIMULATED_CREDITS
  Remove-Item Env:NODE_ENV
}
```

O exemplo usa variáveis temporárias do processo. Abra um terminal dedicado e encerre o servidor ao terminar. Não configure essa flag em produção; a implantação deve definir `NODE_ENV=production`. Não foi alterado nenhum arquivo `.env` ou credencial.

### Diagnóstico seguro de HTTP 403

Na pasta `backend`, execute `npm.cmd run wallet:diagnose`. O comando carrega `backend/.env` e imprime somente booleans: ambiente de desenvolvimento, habilitação explícita, URL válida, protocolo PostgreSQL, host local, nome do banco, parâmetros permitidos, ausência de fragmento e resultado final `enabled`. Não imprime valores das variáveis, credenciais, tokens ou URL.

`src/config/env.ts` carrega o arquivo antes das leituras em `config/wallet.ts`. O caminho é relativo ao arquivo de configuração, funcionando tanto em `src` quanto em `dist`, independentemente da pasta atual. Variáveis herdadas do terminal têm prioridade sobre `.env`, pois o carregamento não usa `override`. Salvar `.env` não recarrega um processo já iniciado; reinicie o servidor. O diagnóstico é executado em um novo processo e não lê o ambiente de uma instância antiga.

O bloqueio identificado nesta investigação era a rejeição de qualquer query string, inclusive o parâmetro Prisma `schema=public`. A validação agora permite somente esse parâmetro opcional, mantendo todas as outras restrições. Após atualizar o código, reinicie `npm.cmd run dev`; caso use `npm.cmd start`, execute `npm.cmd run build` antes de reiniciar.

Para verificar a porta 3000 no Windows sem exibir linhas de comando ou variáveis de outros processos:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Uma instância antiga deve ser encerrada pelo terminal que a iniciou. A conferência desta investigação não encontrou listener na porta 3000; isso descreve o instante da inspeção, não o estado anterior da requisição que retornou 403.

## Consulta da carteira

GET `/api/wallet`, sem query. A carteira é criada automaticamente com saldo zero quando ainda não existe. A criação usa `INSERT ... ON CONFLICT (userId) DO NOTHING` e bloqueio transacional, sem sobrescrever saldo existente; requisições concorrentes não criam múltiplas carteiras.

```json
{
  "wallet": {
    "totalBalance": "100.10",
    "reservedBalance": "30.03",
    "availableBalance": "70.07"
  }
}
```

Sem reservas existentes, o reservado é `"0.00"`. Os três valores são sempre strings com duas casas decimais. Não são retornados identificadores internos de carteira, usuário, versão, dados pessoais ou informações de outras contas. Saldo negativo, reserva negativa ou reserva superior ao total é tratado como inconsistência (409), sem fabricar um saldo disponível.

## Crédito simulado e validação monetária

POST `/api/wallet/credit`, com header obrigatório **`Idempotency-Key`** e JSON contendo somente `amount`:

```json
{ "amount": "150.50" }
```

`amount` deve ser string decimal positiva, de `"0.01"` até `"9999999999999999.99"`, compatível com Decimal(18,2). Aceita uma ou duas casas, ou inteiro textual (`"150"`), normalizando a saída para duas casas. Rejeita números JSON, zero, negativos, espaços, vírgula, zeros inteiros à esquerda, notação exponencial e mais de duas casas. A soma final também precisa caber no mesmo limite; excesso retorna 409 sem alteração do saldo ou movimento extra.

Campos extras como `walletId`, `userId`, `balance`, `balanceAfter`, `type`, `simulated` e `idempotencyKey` no corpo retornam 400. A chave fica no header, e o cliente não controla o tipo ou o saldo final. Query string não é aceita nesse endpoint.

Exemplo de primeira resposta:

```json
{
  "wallet": {
    "totalBalance": "150.50",
    "reservedBalance": "0.00",
    "availableBalance": "150.50"
  },
  "transaction": {
    "id": "11111111-1111-4111-8111-111111111111",
    "type": "CREDIT",
    "amount": "150.50",
    "balanceAfter": "150.50",
    "createdAt": "2026-10-26T15:00:00.000Z",
    "simulated": true
  },
  "replayed": false,
  "simulated": true,
  "message": "Crédito simulado de demonstração, sem depósito ou valor monetário real."
}
```

### Idempotência

O header aceita 1 a 64 caracteres ASCII: letras, números, ponto, hífen, dois-pontos e sublinhado. Exemplo: `demo-credit-001` ou um UUID. Use uma chave nova para cada intenção de crédito; preserve a mesma chave ao reenviar uma requisição cujo resultado é incerto.

O backend persiste a chave como `demo-credit:<usuário autenticado>:<chave>`, com no máximo 113 caracteres, dentro do limite do schema. Assim, usuários diferentes podem usar a mesma chave textual sem compartilhar ou consultar movimentações. O namespace da operação impede conflito com futuros tipos de movimentação. A chave persistida não é exposta no histórico.

- Mesmo usuário, mesma chave e mesmo valor decimal: 200, mesmo `transaction.id`, `replayed: true`, sem novo movimento nem incremento de saldo/versão. `"10"` e `"10.00"` são equivalentes.
- Mesma chave com valor diferente: 409, sem modificar saldo ou transação original.
- Mesmo valor com chave diferente: novo crédito simulado. A idempotência não identifica intenções com chaves diferentes.
- Um reenvio retorna os saldos **atuais** da carteira e a transação **original**. Após outros créditos, `transaction.balanceAfter` pode diferir de `wallet.totalBalance`; o primeiro é o saldo histórico daquela movimentação.
- O bloqueio por ambiente vale também para reenvios; eles não liberam crédito em produção.

Criação da carteira, verificação da chave, atualização do saldo e gravação da movimentação compartilham uma transação Serializable. A carteira é bloqueada com `FOR UPDATE`; cálculos usam exclusivamente `Prisma.Decimal`. Falha em qualquer gravação reverte toda a operação. Conflitos de serialização/deadlock são repetidos até três tentativas; persistindo o conflito, retorna 409 e o cliente pode reenviar **a mesma chave**.

Futuras operações de reserva/liberação/débito deverão bloquear a mesma carteira antes de alterar saldos e reservas; elas não estão implementadas nesta etapa. Não há edição ou exclusão de movimentações na API.

## Histórico

GET `/api/wallet/transactions?page=1&limit=20`:

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Cada item tem os mesmos campos públicos de `transaction` no exemplo de crédito. Movimentos deste endpoint são identificados como simulados pelo tipo CREDIT e namespace persistido `demo-credit:`; outros tipos de histórico não são classificados automaticamente como créditos simulados.

A consulta cria a carteira vazia se necessário e limita a seleção ao usuário autenticado. Ordenação por `createdAt` decrescente e UUID decrescente para desempate; contagem e página ficam na mesma transação. Padrões: `page=1`, `limit=20`; limites: página até 1000000 e limite até 100. Queries desconhecidas ou duplicadas retornam 400.

## Postman

Defina `baseUrl` (por exemplo, `http://localhost:3000/api`, ajustando à porta configurada), `bidderToken` e `creditKey`. Faça login com um BIDDER existente e use Bearer `{{bidderToken}}` em todas as requisições.

1. GET `{{baseUrl}}/wallet`: 200, carteira zerada no primeiro acesso.
2. POST `{{baseUrl}}/wallet/credit`, header `Idempotency-Key: {{creditKey}}`, JSON `{"amount":"150.50"}`: 201 com `simulated: true`, após habilitar a demonstração no servidor.
3. Repita sem trocar chave/valor: 200, mesmo ID e `replayed: true`.
4. Preserve a chave e troque para `{"amount":"151.00"}`: 409.
5. Use chave nova e JSON `{"amount":"0.10"}`: 201, novo movimento.
6. GET `{{baseUrl}}/wallet/transactions?page=1&limit=1`: 200, um movimento por página e total correspondente.
7. Teste sem token (401), com AUCTIONEER (403), valor numérico/zero/inválido (400) ou `userId` no corpo/query (400).
8. Faça login com outro BIDDER: saldo e histórico devem ser independentes, mesmo usando o mesmo `creditKey`.
9. Desabilite a flag ou execute em produção: POST retorna 403; nenhuma movimentação é registrada.

Exemplo de script Post-response para a primeira requisição de crédito:

```javascript
pm.test("Crédito de demonstração criado", () => pm.response.to.have.status(201));
const body = pm.response.json();
pm.expect(body.simulated).to.eql(true);
pm.environment.set("transactionId", body.transaction.id);
```

Não gere automaticamente uma nova chave a cada reenvio de teste de idempotência.

## Erros

| HTTP | Situação |
|---|---|
| 400 | Corpo, valor, chave, query ou paginação inválidos |
| 401 | Token ausente/inválido/expirado ou usuário inexistente |
| 403 | Perfil diferente de BIDDER ou crédito não habilitado no ambiente permitido |
| 409 | Chave usada com outro valor, limite de saldo, inconsistência ou conflito concorrente |
| 500 | Falha inesperada, com mensagem genérica |

## Testes

Na pasta `backend`:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Testes opcionais com PostgreSQL real e regressão completa, sem modificar `.env`:

```powershell
$env:WALLET_DATABASE_TESTS = '1'
$env:LOT_DATABASE_TESTS = '1'
$env:VEHICLE_DATABASE_TESTS = '1'
try { npm.cmd run test:integration } finally {
  Remove-Item Env:WALLET_DATABASE_TESTS
  Remove-Item Env:LOT_DATABASE_TESTS
  Remove-Item Env:VEHICLE_DATABASE_TESTS
}
```

O comando de integração executa arquivos em sequência para evitar interferência entre fixtures Serializables. Dentro da suíte concorrente, os cenários usam conexões/transações simultâneas reais. As configurações de demonstração são injetadas apenas nas instâncias de teste; o servidor e suas variáveis não são alterados.

`wallet.test.ts` usa HTTP/JWT reais e repositório em memória. `wallet-repository.test.ts` testa limites de repetição de conflitos. `wallet.database.test.ts` testa consultas, histórico, reservas preexistentes, limites, rollback e idempotência usando savepoints e rollback integral das fixtures. `wallet.concurrency.test.ts` usa contas de teste próprias temporariamente confirmadas, necessárias para múltiplas conexões; em `finally`, remove apenas suas carteiras, movimentações de teste e usuários identificados por UUIDs gerados pela própria suíte. Não altera contas ou históricos preexistentes. Interrupção forçada antes do `finally` pode deixar fixtures identificáveis por e-mails `@example.invalid` para inspeção manual.

Nenhuma aprovação de schema foi necessária. Créditos permanecem limitados à demonstração local; pagamentos reais, lances e reservas são etapas separadas.

## Resultado da validação

Após a correção da validação de `schema=public`, passaram **266 testes** na regressão completa, sendo 236 sem banco e 30 com PostgreSQL real. Os testes da carteira somam 64: 46 HTTP, 6 de tratamento de conflitos e 12 com banco (8 cenários transacionais e 4 concorrentes). O comando padrão, typecheck e build também passaram.

A conferência final comparou contagens e resumos dos registros das tabelas de usuários, leilões, veículos, lotes e financeiras com a leitura anterior aos testes: todos permaneceram iguais. Nenhuma carteira ou movimentação de teste ficou persistida.
