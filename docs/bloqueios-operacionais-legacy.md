# Isolamento operacional LEGACY

Implementação preparada para revisão. Nenhuma migração aplicada, nenhum Prisma Client regenerado, nenhuma ativação de UTC. Não foram executados comandos Git, nem alterados `.env`, credenciais, dados históricos ou funções de hash SHA-256.

## Comportamento

- Apenas `UTC_V2` permite novas operações. `LEGACY`, geração ausente ou desconhecida retornam `HttpError(409)` nas escritas operacionais.
- Agendamento e abertura verificam a geração antes da transição, inclusive nos reenvios que seriam tratados como transição já aplicada.
- Edição e cancelamento do leilão também são bloqueados. O isolamento cobre inclusive metadados, mantendo o registro histórico estável.
- Criação, edição e exclusão de lotes LEGACY e mutações de veículos vinculados são bloqueadas dentro das transações.
- Novos lances LEGACY são rejeitados antes de qualquer escrita financeira, extensão ou evento. Replay válido de um lance previamente registrado retorna o lance original, sem reservas, ledger, incremento de versão, prorrogação ou publicação. A chave continua vinculada a usuário, valor e lote pelo mecanismo existente.
- Liquidação direta de LEGACY retorna resultado vazio antes do relógio, lote, carteira, comprovante ou auditoria, inclusive no caminho de recuperação de leilões com lotes terminais.
- Os dois ramos SQL de descoberta do worker filtram `UTC_V2`. A liquidação revalida a geração sob lock, protegendo também contra candidatos obsoletos ou chamadas diretas.
- Consultas de leilões, lotes, lances e comprovantes permanecem sem filtro por geração. A autorização dos comprovantes não foi alterada.
- O REST continua rejeitando `temporalGeneration`. Criação/edição por serviços e repositório de leilões também rejeitam esse campo em runtime. O default do banco permanece LEGACY; não há código de promoção ou criação UTC_V2 nesta entrega.

## Implementação e arquivos

Arquivos de produção alterados/criados em `backend/src/modules/`:

- `temporal/auction-generation.ts`: guard fechado, leitura parametrizada e rejeição do marcador externo.
- `auctions/auction.repository.ts`: leitura transacional, proteção de escrita e factory para testes isolados.
- `auctions/auction.service.ts`: bloqueio na decisão transacional e rejeição do marcador externo.
- `auctions/auction-lifecycle.repository.ts` e `auction-lifecycle.service.ts`: bloqueios de agendamento e abertura.
- `bids/bid.repository.ts` e `bid.service.ts`: bloqueio de novos lances, preservando replay sem efeitos.
- `settlement/settlement.repository.ts`: filtro de descoberta e revalidação transacional antes da captura.
- `lots/lot.repository.ts` e `vehicles/vehicle.repository.ts`: proteção contra mutações vinculadas.

A leitura explícita por SQL é necessária porque o client gerado atual não conhece a coluna. Ela ocorre dentro da mesma transação e após adquirir o lock do leilão. Não usa inferência por datas ou status. Os callbacks de validação continuam dentro da transação; os repositórios impedem escritas LEGACY mesmo quando chamados com callbacks permissivos. Não houve mudança na ordem dos locks, nos retries ou no protocolo de chave idempotente.

Testes alterados/criados em `backend/tests/`:

- `auction-temporal-acceptance.test.ts`: seis TODOs convertidos em testes obrigatórios; cinco consultas históricas mantidas.
- `auction-temporal-isolation.test.ts`: regressões dos repositórios reais com mocks transacionais, callbacks permissivos, marcadores inválidos, leitura histórica, replay sem escrita, lance novo UTC_V2 e encerramento UTC_V2 sem lance com auditoria.
- `auctions.test.ts`, `auction-lifecycle.test.ts`, `bids.test.ts`: fixtures operacionais em memória explicitamente UTC_V2, sem mudar fixtures PostgreSQL.

Documentação: este arquivo e `geracao-temporal-leiloes.md`.

## Validação

Executado em `backend/`:

- `npm.cmd run typecheck`: aprovado, incluindo tipos de testes, com o client existente.
- Testes de aceitação/modelo temporal e HTTP de leilões, transições e lances: 97 aprovados.
- Suíte completa sem PostgreSQL: 416 testes aprovados, zero falhas, zero skips e zero TODOs. Seleção de 25 arquivos `tests/*.test.ts` excluindo os que contêm `DATABASE_TESTS`; execução via `node --import tsx --test` com a lista explícita resultante. Não foram habilitadas suítes dependentes de banco.

## Limitações e próxima etapa

Esta versão exige a coluna nova nas escritas protegidas e na descoberta do worker. Não iniciar esses fluxos no banco atual: a coluna ausente causa erro SQL, não um erro de negócio LEGACY. As consultas históricas continuam usando o client compatível com o banco atual. Não foi acrescentado fallback que permita operações sem o marcador.

Mocks não demonstram locks reais, isolamento PostgreSQL, plano de execução do índice, captura financeira UTC_V2 completa ou concorrência entre versões. As suítes PostgreSQL existentes e suas fixtures ainda precisam ser alinhadas ao marcador e executadas em banco isolado após autorização da próxima etapa. A validação não demonstra prontidão para implantação.

A cadeia de auditoria v1/v2 está preparada em `auditoria-versionada.md`, sem reescrever hashes antigos; falta sua validação PostgreSQL. O pool UTC, preflight e gravação explícita UTC_V2 estão preparados em `ativacao-utc-v2.md`, sem ativação. Falta a validação integrada de lances, captura, comprovantes, concorrência e worker. Antes de qualquer implantação, revisar leilões OPEN e reservas ACTIVE, drenar escritas/parar workers e impedir execução simultânea da versão antiga. A aplicação da migração, regeneração do client e ativação continuam pendentes de aprovação específica.
