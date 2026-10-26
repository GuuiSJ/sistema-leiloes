# Contrato mínimo da auditoria de abertura

Gravador implementado após autorização explícita, sem migração. Além de AUCTION_OPENED e LOT_OPENED, suporta encerramento e liquidação conforme os contratos abaixo. Não há API pública de auditoria, ancoragem externa ou gravação retroativa de eventos dos módulos anteriores.

## Campos e privacidade

Um evento usa os campos existentes `id`, `sequence`, `authorId`, `action`, `entityType`, `entityId`, `occurredAt`, `publicData`, `previousHash` e `currentHash`. O autor é o usuário autenticado, mas `authorId` é privado e não é retornado pelas respostas de abertura nem necessário para verificar o conteúdo público.

Lista permitida de `publicData`, sem campos adicionais:

| Ação e entidade | Dados públicos |
|---|---|
| AUCTION_OPENED / Auction | `formatVersion: 1`, `status: "OPEN"`, `lotIds`: UUIDs dos lotes efetivamente abertos, únicos e ordenados |
| LOT_OPENED / Lot | `formatVersion: 1`, `status: "OPEN"`, `auctionId`: UUID, `number`: inteiro positivo |
| LOT_CLOSED / Lot | `formatVersion: 1`, `status: "SOLD"` ou `"UNSOLD"`, `auctionId`: UUID |
| FUNDS_DEBITED / Lot | `formatVersion: 1`, `status: "SOLD"`, `auctionId`: UUID |
| RECEIPT_ISSUED / Lot | `formatVersion: 1`, `status: "SOLD"`, `auctionId`: UUID |
| AUCTION_CLOSED / Auction | `formatVersion: 1`, `status: "CLOSED"` |

Nome, e-mail, hashes de senha, tokens, credenciais, saldo, carteira e URLs não entram nos dados públicos. A lista permitida é validada antes da gravação e na verificação dos eventos existentes.

## Formato do hash, versão 1

O hash é SHA-256, hexadecimal minúsculo de 64 caracteres, do JSON canônico UTF-8 deste objeto:

```text
{
  formatVersion: 1,
  id,
  sequence: string decimal do BigInt,
  action,
  entityType,
  entityId,
  occurredAt: ISO UTC com milissegundos,
  publicData,
  previousHash
}
```

A canonicalização ordena recursivamente as chaves dos objetos pela ordem padrão de strings do JavaScript, preserva a ordem de arrays e usa `JSON.stringify` para valores primitivos, sem espaços. Não é anunciada como implementação geral de outro padrão de canonicalização; o contrato restringe os tipos aos dados acima. `authorId` e `currentHash` não participam do hash. Portanto, a cadeia verifica conteúdo público e encadeamento, sem garantir criptograficamente a atribuição privada do autor.

O primeiro evento tem `previousHash: null`. Cada seguinte aponta para `currentHash` do anterior. `sequence` é alocada pela sequência PostgreSQL existente e integra o hash; precisa ser estritamente crescente, podendo ter lacunas por rollback. Dentro da abertura, grava-se primeiro o evento do leilão e depois os eventos dos lotes em ordem de UUID, com o mesmo horário de aceitação.

## Concorrência e verificação

O gravador é usado dentro da transação Serializable da abertura. Ele adquire `LOCK TABLE "AuditEvent" IN SHARE ROW EXCLUSIVE MODE` antes de ler a cadeia, inclusive quando ela está vazia. O bloqueio impede inserções concorrentes durante o lote de eventos. O isolamento e as tentativas da operação tratam snapshots anteriores ao bloqueio e conflitos de serialização.

Antes de anexar eventos, verifica-se **toda** a cadeia ordenada por sequência: formato/ação suportados, dados permitidos, hashes recalculados, sequência crescente e referência ao hash anterior. Isso exige uma única raiz e impede aceitar uma bifurcação ou alteração de conteúdo. A verificação completa é conservadora e tem custo linear no tamanho do histórico; otimizações futuras precisam preservar essas garantias.

As restrições únicas de `previousHash` não nulo e `currentHash` continuam ativas. A segurança da raiz não depende apenas de `UNIQUE`, pois PostgreSQL permite múltiplos valores nulos; ela depende do protocolo transacional e da verificação completa. Os testes reais cobrem duas aberturas concorrentes em uma cadeia inicialmente vazia.

Erro de auditoria faz rollback dos status e de todos os eventos dessa abertura. Cadeia inválida, registros legados sem formato compatível ou outra ação ainda não suportada retornam 409; o gravador não apaga, reescreve, reencadeia ou ignora esses registros. Um novo formato/ação deve ter contrato e verificação definidos antes de ser usado por outro módulo.

O módulo não cria eventos de abertura em cancelamentos, agendamentos ou reenvios sem transição. Não adiciona dados históricos fictícios.

## Limites do mecanismo

A cadeia detecta conteúdo ou elos alterados quando comparados ao histórico armazenado, mas não impede que um administrador reescreva a cadeia inteira ou remova seu final. Imutabilidade por privilégios, ancoragem externa e publicação do hash final permanecem etapas separadas. Não foram alteradas permissões do banco nesta entrega.

Todos os futuros gravadores devem seguir o mesmo protocolo de bloqueio, formato versionado, seleção pública e transação. Escritas diretas em AuditEvent fora desse protocolo podem tornar a cadeia incompatível e bloquear novas aberturas; exigem revisão administrativa, sem reparo automático.

## Encerramento e liquidação

O worker usa `prepareAuditWriter` do mesmo módulo da abertura. Eventos automáticos possuem `authorId: null`. As ações FUNDS_DEBITED e RECEIPT_ISSUED referenciam o lote, sem publicar IDs de carteira, reserva, participante ou movimentação, nem saldo. Os detalhes privados permanecem nas tabelas financeiras e no comprovante autenticado.

A ordem de bloqueios é Auction → Lot → carteira → AuditEvent. No encerramento grava-se LOT_CLOSED e, para venda, FUNDS_DEBITED e RECEIPT_ISSUED; se todos os lotes forem terminais, AUCTION_CLOSED. Tudo compartilha a transação Serializable da captura. Cadeia inválida causa rollback do débito, reserva, resultado e comprovante. Reprocessamentos não criam novos eventos.

Os hashes e a serialização de aberturas antigas permanecem exatamente iguais. O verificador agora aceita a cadeia mista, mantendo listas de campos estritas por ação. Um vetor SHA-256 fixo protege a compatibilidade do formato antigo; testes PostgreSQL verificam abertura → encerramento → nova abertura, concorrência e bloqueio após adulteração. A sequência pode ter lacunas por rollback, preservando seu crescimento estrito. Veja [encerramento-liquidacao.md](encerramento-liquidacao.md).
