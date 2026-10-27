# Preparação da ativação controlada UTC_V2

Estado: código preparado, ativação desabilitada no ambiente atual. Não foram aplicadas migrações, regenerado o Prisma Client, abertos pools de validação, modificados registros/hashes, alterados `.env`/credenciais ou executados comandos Git.

## Configuração e liberação

`AUCTION_TEMPORAL_MODE` aceita exclusivamente `LEGACY` (default) ou `UTC_V2`. A configuração é capturada ao carregar o processo; alterar uma variável depois disso não ativa nem desativa a versão em execução. Não foi acrescentado valor a `.env`.

No modo LEGACY, o pool mantém sua configuração anterior e a criação omite o marcador, preservando o default LEGACY do banco. O worker não inicia neste modo. Essa opção não remove os guards de leilões LEGACY nem torna utilizáveis as escritas operacionais que exigem a coluna ainda ausente.

No modo solicitado UTC_V2, o pool recebe `options: '-c timezone=UTC'` na abertura de **cada conexão física**, incluindo as criadas posteriormente. Não é um `SET` aplicado apenas à primeira conexão. A URL não pode conter `options`, `timezone` ou `tz`, inclusive chaves codificadas ou com outra capitalização, pois o `pg` permite que parâmetros da URL sobrescrevam PoolConfig. Outros parâmetros e credenciais não são alterados nem registrados em logs.

HTTP, worker, transações e operações financeiras usam o mesmo singleton de Prisma. `getPrisma()` bloqueia acesso antes da validação em ambos os modos. Somente a inicialização consegue acessar internamente o pool candidato. O script de promoção administrativa agora chama `connectDatabase()` após validar argumentos/ambiente local e antes da consulta; preserva a confirmação exigida antes da escrita. Não foi criado bypass para scripts administrativos. Fixtures PostgreSQL antigas que usam diretamente o singleton também precisarão inicializá-lo explicitamente.

O modo só fica **efetivamente ativo** depois do preflight completo. Apenas então a criação pelo repositório inclui explicitamente `temporalGeneration: 'UTC_V2'`. Não há atualização de leilões existentes nem alteração do default global. O HTTP, serviço e repositório continuam rejeitando o campo fornecido pelo cliente; ele não pode selecionar a geração ou promover um registro.

## Preflight de inicialização

`connectDatabase()` aguarda a verificação antes de retornar. O servidor só abre HTTP/Socket.IO depois desse retorno; o worker também exige prontidão em `start()`, `tick()` e entre candidatos. Ao desconectar ou iniciar uma nova verificação, a prontidão é revogada. Falhas impedem a abertura do servidor e não liberam criação UTC_V2.

As verificações são somente leitura:

1. O Prisma Client efetivamente instalado deve exportar o campo escalar e o enum `AuctionTemporalGeneration` com exatamente LEGACY/UTC_V2. O client atual não passa nesse requisito UTC e não foi regenerado. Uma seleção ORM da coluna também é exercitada no banco, depois das verificações de catálogo.
2. Catálogo PostgreSQL: coluna obrigatória do enum correto, labels esperados, default constante LEGACY e índice válido/pronto sobre geração/status. O schema resolvido é o da mesma relação `Auction` usada pelo SQL da aplicação. Em LEGACY também se exige que presença da coluna e suporte do client concordem.
3. Registro concluído e não revertido da migração `20261028000000_auction_temporal_generation` em `_prisma_migrations`. Aplicação manual sem o registro de migração não é aceita automaticamente.
4. Nenhum leilão LEGACY OPEN nem reserva ACTIVE ligada a LEGACY. Registros UTC_V2 ativos não impedem reinicializações normais da nova versão.
5. Os vinte campos temporais catalogados devem ser `timestamptz(3)`.
6. Dentro de uma transação do pool candidato: `TimeZone = UTC`, Date lida pelo adapter igual ao epoch físico do PostgreSQL e parâmetro Date com milissegundos igual ao epoch SQL, sem deslocamento.
7. Leitura da cadeia de auditoria completa pelo loader versionado e verificação v1 → v2. Não há recálculo persistente nem correção de registros.

LEGACY é recusado após detectar leilões UTC_V2 ou eventos de auditoria v2. O gravador de auditoria continua aceitando exclusivamente v2; a cadeia rejeita v1 após v2. A aplicação não instala trigger para impedir gravadores externos/antigos: encerrar esses processos é condição obrigatória da virada.

O preflight não aplica migração, não verifica uma conexão por vez com `SET`, não converte dados e não equivale a uma prova contra alterações posteriores do schema ou de configurações feitas por outros processos. O deploy deve impedir DDL e gravadores concorrentes durante a janela.

## Consultas históricas e contrato de resposta

Trocar o fuso do adapter pode alterar a **representação retornada** de timestamps antigos: por exemplo, um instante físico 18:00Z antes apresentado como 15:00Z passa a ser lido como 18:00Z em UTC. Isso não comprova que 18:00Z era a intenção original. Não corrigimos esses dados por um offset fixo, por data de criação ou pela geração do leilão.

Para não apresentar essa mudança como uma normalização histórica implícita, respostas JSON de sucesso do HTTP em modo efetivamente UTC incluem:

```json
{
  "temporal": {
    "representation": "STORED_UTC_INSTANT",
    "legacyCanonicalMeaning": "UNKNOWN",
    "historicalNormalization": "NONE"
  }
}
```

Esse campo é adicional ao corpo original: não troca datas, epochs, comprovantes ou hashes. Declara que datas trafegam como instantes físicos armazenados e que a interpretação canônica do legado não foi estabelecida para todos os campos. Não promete manter os textos de datas do HTTP antigo depois da virada. As consultas de leilões, lotes, lances e comprovantes continuam disponíveis; as regras de acesso permanecem as mesmas. O campo interno de geração não é exposto pelo DTO de leilão.

O consumidor deve reconhecer esse contrato **antes** da ativação. Se a exigência de produto for manter o mesmo texto de data histórica da versão anterior, a implantação fica pendente de uma camada de apresentação histórica específica; esta etapa não tenta inventar essa interpretação. O inventário e suas provas por campo continuam sendo a fonte para classificações futuras. A representação assinada da auditoria v1 é a exceção comprovada e continua sendo reconstruída somente em memória pelo loader versionado.

## Testes executados

Em `backend/`:

- `npm.cmd run typecheck`: aprovado com o client atual, incluindo tipos dos testes PostgreSQL preparados.
- Suíte inteira sem PostgreSQL: **464 testes aprovados**, zero falhas, skips ou TODOs, em 27 arquivos. São os 441 anteriores e 23 novos testes de ativação. A execução seleciona arquivos `tests/*.test.ts` que não contêm `DATABASE_TESTS` e passa a lista explícita a `node --import tsx --test`.
- Testes cobrem flag desabilitada/inválida, conflito na URL, incompatibilidade de client/schema/migração/tipos, operações LEGACY ativas, deslocamento de epoch na leitura e no parâmetro, falha da auditoria/ORM, downgrade, criação condicionada, rejeição do marcador externo, suspensão do worker e contrato histórico explícito. Os testes de isolamento LEGACY, auditoria v1/v2 e idempotência continuam passando.

Não foi executado nenhum teste com conexão PostgreSQL nesta entrega. Mocks não validam a sintaxe das consultas de catálogo no servidor nem o comportamento do adapter após regeneração.

## Testes PostgreSQL preparados e pendências

`utc-activation.database.test.ts` contém suites opt-in, **não habilitadas**:

- `UTC_ACTIVATION_DATABASE_TESTS=1`: pools dedicados UTC com `default_transaction_read_only=on`, três sessões físicas distintas e transações herdando UTC; comparação Date/epoch/parâmetro pelo adapter. Não depende da migração de Auction nem altera o singleton da aplicação.
- `UTC_ACTIVATION_MIGRATED_DATABASE_TESTS=1`: preflight completo em banco previamente migrado e com client regenerado, também somente leitura. O teste usa um runtime local e o revoga ao terminar; não ativa o servidor ou worker.

Essas flags são documentação de uma execução futura autorizada, não comandos executados agora. As suites existentes PostgreSQL também permanecem desabilitadas.

Ainda é necessário validar em PostgreSQL isolado:

1. SQL de catálogo/default/índice e registro da migração, schema search_path, client regenerado e preflight real. Confirmar falha sem coluna, com índice inválido, migração incompleta e client antigo.
2. Todas as conexões novas, reutilizadas e substituídas do pool, herança UTC em transações Serializable, epoch dos defaults NOW(), parâmetros Date, atualizações automáticas do ORM e milissegundos reais.
3. Criação real gravando UTC_V2 e todos os campos temporais novos com epoch esperado, além de abertura, lance, extensão, reservas, captura e comprovante. Não basta um SELECT ou round-trip Date→Date.
4. Guards LEGACY, permissões, idempotência/replay, concorrência com duas conexões, rollback financeiro integral e publicação apenas depois do commit. Alinhar fixtures antigas ao marcador e à auditoria SQL v2 antes de executar.
5. Cadeia mista, projeção IANA v1 em datas de verão/inverno, fingerprint físico e hashes históricos idênticos antes/depois. A validação de leitura deve usar o loader, não a Date bruta do ORM em outro fuso.
6. Contrato de consultas históricas no frontend/consumidores: comparar os mesmos registros nos dois fusos, reconhecer UNKNOWN e evitar anunciar uma correção de significado que não foi comprovada.

## Plano de ativação, sujeito a aprovação

1. Revisar esta entrega e validar os itens acima primeiro em banco descartável aprovado. Preparar artefato com schema e client alinhados, sem tocar no banco atual nesta fase. Não habilitar a flag como tentativa de corrigir uma falha de startup.
2. Aprovar janela, registrar backup/fingerprint e inventário; conferir cadeia, leilões OPEN e reservas ACTIVE. Se houver operação LEGACY ativa, interromper a virada para decisão específica, sem cancelá-la ou liquidá-la automaticamente.
3. Drenar HTTP/escritas, parar workers e encerrar todos os processos antigos. Bloquear outras escritas/DDL durante a janela.
4. Somente após aprovação específica, aplicar a migração aditiva já revisada e confirmar o registro de conclusão. Regenerar o client com o schema aprovado, completar typecheck/testes e implantar o artefato compatível. Não regenerar ou conectar o client novo ao banco anterior à coluna.
5. Configurar `AUCTION_TEMPORAL_MODE=UTC_V2` no processo de deploy aprovado e iniciar uma única instância. O preflight precisa passar integralmente antes de abrir tráfego ou iniciar o worker. Conferir metadados temporais das consultas históricas nos consumidores já adaptados.
6. Validar canário controlado UTC_V2 com epochs SQL, fluxo financeiro completo e extensão da mesma cadeia. Conferir que o prefixo LEGACY/dados/hashes permaneceu idêntico, sem promoção automática.
7. Só então ampliar instâncias/tráfego. Após existir UTC_V2 ou auditoria v2, não retornar a um gravador LEGACY ou versão antiga; em falha, parar as escritas e avaliar correção adiante. Não há rollback automático de dados, hashes ou geração.

## Arquivos desta etapa

- `backend/src/config/temporal.ts`: configuração explícita e parâmetros do pool.
- `backend/src/modules/temporal/temporal-runtime.ts`: preflight e prontidão.
- `backend/src/lib/prisma.ts`: pool condicionado e gate de acesso.
- `backend/src/server.ts`: manutenção da ordem do bootstrap e diagnóstico temporal controlado.
- `backend/src/scripts/promote-auctioneer.ts`: preflight antes da primeira consulta administrativa, mantendo as regras anteriores de confirmação/autorização.
- `backend/src/workers/settlement-worker.ts`: gate de prontidão em todas as entradas/candidatos.
- `backend/src/modules/auctions/auction.repository.ts`: criação UTC_V2 somente quando verificada.
- `backend/src/modules/auctions/auction.types.ts`: DTO público explícito compatível com o futuro campo gerado.
- `backend/src/middlewares/temporal-representation.ts` e `backend/src/app.ts`: semântica explícita das respostas UTC.
- `backend/tests/utc-activation.test.ts`: validação isolada da ativação.
- `backend/tests/utc-activation.database.test.ts`: suites somente leitura, pendentes de execução.
- `backend/tests/settlement-worker.test.ts`: prontidão injetada explicitamente nas fixtures existentes.
- `docs/ativacao-utc-v2.md`, `docs/inventario-temporal.md`, `docs/geracao-temporal-leiloes.md`, `docs/auditoria-versionada.md` e `docs/bloqueios-operacionais-legacy.md`: estado e plano atualizados.
