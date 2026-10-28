# Sala de lances e resultados do leiloeiro

Reutilizados: galeria, informações/status, preço e incremento, histórico paginado, formulário com confirmação/idempotência, Socket.IO e regras de prorrogação/liquidação. Meus arremates, comprovantes e auditoria não foram refeitos.

Lacunas informadas antes da implementação: relógio confiável por lote, posição privada do participante e consulta de resultados filtrada pelo proprietário. Acrescentadas somente rotas GET:
- `/api/lots/:lotId/clock`: público; prazo, estados, relógio do banco e confiança temporal somente para UTC_V2 com runtime ativo.
- `/api/lots/:lotId/position`: BIDDER; situação própria e ID público do último lance, sem identificação dos outros participantes.
- `/api/me/lot-results?page=1&limit=10&auctionId=UUID`: AUCTIONEER; lotes SOLD/UNSOLD dos seus leilões; filtro opcional valida responsabilidade. Valores vêm do comprovante, nunca do preço inicial ou de uma estimativa.

Reutilizados GET de leilão, lote, lances e elegibilidade, e o POST de lance já existente (não acionado na validação real). Eventos: `lot:join`, `lot:leave`, `bid:created`, `lot:extended`, `lot:closed`, `auction:closed`, conexão e reconexão. Notificações continuam invalidando snapshots GET; não autorizam lances.

A contagem é estimada por amostra do relógio do servidor e tempo monotônico do navegador. Exige prazo/estados coerentes e conexão sincronizada. Zero significa aguardar confirmação, não liquidação automática no cliente. O backend continua responsável por prorrogar e encerrar. A posição privada só aparece se corresponder ao último lance e estado do snapshot público.

Navegação: detalhes públicos do leilão → selecionar lote; painel do leiloeiro → Resultados. O vencedor é identificado pelo ID público do lance, sem nome, e-mail ou identificação pessoal.

Validação: typecheck e build backend/frontend aprovados; 26 testes backend e 229 frontend aprovados. Um teste FIPE ao vivo ficou ignorado por padrão, fora do escopo. Chromium com GETs/eventos simulados verificou lance, prorrogação, reconexão, encerramento, resultados, vazio e erro. Testes backend usaram Socket.IO real com fixtures, sem banco. GET real confirmou relógio confiável de um lote UTC_V2 e 401 nas consultas privadas. Não foi realizado lance real ou fluxo financeiro de demonstração. Build frontend aprovado com aviso de chunk acima de 500 kB; sem refatoração de empacotamento neste escopo.

## Arquivos desta entrega

- `backend/src/modules/lots/live-room.repository.ts`
- `backend/src/modules/lots/live-room.routes.ts`
- `backend/src/routes/index.ts`
- `backend/tests/live-room.test.ts`
- `frontend/src/services/live-room.ts`
- `frontend/src/services/auctions.ts`
- `frontend/src/hooks/useLiveLot.ts`
- `frontend/src/components/auctions/LotCountdown.tsx`
- `frontend/src/components/auctions/LotBidSummary.tsx`
- `frontend/src/components/auctions/LotDetails.tsx`
- `frontend/src/components/auctions/LotPosition.tsx`
- `frontend/src/components/auctions/LotOutcome.tsx`
- `frontend/src/pages/AuctioneerResultsPage.tsx`
- `frontend/src/components/auctioneer/AdminLayout.tsx`
- `frontend/src/App.tsx`
- `frontend/tests/live-room.test.mjs`
- `frontend/tests/helpers/live-room-browser.tsx`
- `frontend/tests/helpers/live-room-socket.ts`
- `docs/entrega-sala-resultados.md`
