# Publicação e abertura automática

Causa: o frontend não utilizava `PATCH /api/auctions/:id/schedule`; o worker existente processava apenas encerramentos de OPEN, não aberturas de SCHEDULED. A API também já possuía `/open`. LIVE é representado por `OPEN`, exibido como **Ao vivo**.

Fluxo: DRAFT → confirmação de publicação → PATCH sem corpo e com JWT → SCHEDULED → worker → OPEN e lotes OPEN. Publicação exige responsável AUCTIONEER, UTC_V2, período futuro válido e ao menos um lote válido não cancelado. As validações existentes de propriedade, valores, histórico, versão, concorrência e auditoria permanecem.

O mesmo `SettlementWorker`, a cada segundo, agora descobre agendados UTC_V2 cujo início chegou e término não venceu. Reutiliza `AuctionLifecycleService` e o repositório transacional. Abertura automática registra autor nulo, sem atribuir ação automática a um humano. Locks, revalidação do relógio e idempotência são preservados. Falha de abertura não desativa encerramentos.

## Iniciar e conferir

Com `AUCTION_TEMPORAL_MODE=UTC_V2` no `backend/.env`, reiniciar o backend:

```powershell
cd C:\Users\djesu\sistema-leiloes\backend
npm.cmd run dev
```

Não há outro worker ou terminal adicional para o processamento. A versão compilada usa `npm.cmd run build`, depois `npm.cmd start`.

O terminal deve mostrar `Processamento automático UTC_V2 iniciado: abertura e encerramento a cada segundo.` e, quando abrir, `Leilão aberto automaticamente.` com o identificador. Falhas são registradas como `OPENING_BLOCKED` ou `OPENING_FAILED`, sem detalhes privados. O bootstrap continua impedindo ativação se os pré-requisitos UTC falharem.

No navegador: Área do leiloeiro → Leilões → escolher DRAFT UTC_V2 com início futuro → concluir lotes → Publicar leilão → Confirmar publicação. A listagem recarrega e mostra Agendado; enquanto houver agendados visíveis, reconsulta a cada cinco segundos. Os detalhes públicos também reconsultam agendados. Ao chegar o início, deve aparecer Ao vivo; `GET /api/auctions/:id` deve retornar `status: OPEN`, e os lotes elegíveis ficam OPEN.

O backend precisa permanecer em execução. Se voltar somente após o término, a abertura tardia continua bloqueada pelas regras existentes; não se força OPEN nem se alteram datas antigas. LEGACY permanece protegido.

Validação: typecheck e build backend/frontend aprovados; 88 testes backend e 236 frontend aprovados; um teste FIPE ao vivo ignorado por padrão. Chromium verificou confirmação, cancelamento, envio único, mensagens de restrição e atualização SCHEDULED → Ao vivo. Abertura automática foi exercitada com repositório transacional simulado; SQL de descoberta foi consultado no PostgreSQL com conexão READ ONLY, sem candidatos. Nenhum leilão real foi publicado, aberto ou alterado pelos testes; nenhum lance, crédito ou migração foi executado.

## Arquivos alterados

- `backend/src/modules/auctions/auction-lifecycle.repository.ts`
- `backend/src/modules/auctions/auction-lifecycle.types.ts`
- `backend/src/workers/scheduled-opening.ts`
- `backend/src/workers/settlement-worker.ts`
- `backend/src/server.ts`
- `backend/tests/scheduled-opening.test.ts`
- `frontend/src/services/auction-management.ts`
- `frontend/src/components/auctioneer/AuctionPublication.tsx`
- `frontend/src/pages/AuctioneerListsPage.tsx`
- `frontend/src/pages/AuctionDetailsPage.tsx`
- `frontend/src/components/auctions/AuctionInfo.tsx`
- `frontend/tests/auction-publication.test.mjs`
- `frontend/tests/helpers/auction-publication-browser.tsx`
- `frontend/tests/live-room.test.mjs` (somente isolamento do cache Vite dos testes)
- `docs/publicacao-abertura.md`
