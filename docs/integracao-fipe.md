# Integração FIPE — BrasilAPI

Consultas públicas, sem autenticação e sem persistência. Esta etapa não cadastra
veículos, não cria lotes e não altera o schema ou as variáveis de ambiente.

## Contrato oficial consultado

Fontes consultadas em 24/10/2026:

- [Documentação oficial da BrasilAPI — FIPE](https://brasilapi.com.br/docs#tag/FIPE).
- [OpenAPI FIPE no repositório oficial](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/fipe.json).
- [Implementação oficial da consulta de modelos](https://github.com/BrasilAPI/BrasilAPI/blob/main/services/fipe/vehiclesByMakers.js).
- [Implementação oficial de preços por código](https://github.com/BrasilAPI/BrasilAPI/blob/main/services/fipe/price.js).

O contrato atual suporta marcas, modelos, anos/combustíveis, preço por código,
detalhes pela hierarquia e tabelas de referência. Não foi necessário usar outro
provedor. A rota externa de modelos é `veiculos`, não `modelos`.

## Rotas e correspondência externa

Todas as rotas abaixo são GET. A base externa utilizada é fixa:
`https://brasilapi.com.br/api/fipe`. O `/api` faz parte do endereço executável
do serviço, ainda que os caminhos da especificação sejam relativos.

| Rota local | Caminho na base externa |
| --- | --- |
| `/api/fipe/marcas` | `/marcas/v1` |
| `/api/fipe/marcas/:vehicleType` | `/marcas/v1/:vehicleType` |
| `/api/fipe/modelos/:vehicleType/:makerCode` | `/veiculos/v1/:vehicleType/:makerCode` |
| `/api/fipe/anos/:vehicleType/:makerCode/:modelCode` | `/anos/v1/:vehicleType/:makerCode/:modelCode` |
| `/api/fipe/preco/:fipeCode` | `/preco/v1/:fipeCode` |
| `/api/fipe/detalhes/:vehicleType/:makerCode/:modelCode/:yearCode` | `/detalhes/v1/:vehicleType/:makerCode/:modelCode/:yearCode` |
| `/api/fipe/tabelas` | `/tabelas/v1` |

`vehicleType`: `carros`, `motos` ou `caminhoes`, exatamente em minúsculas.
`makerCode` e `modelCode` são códigos numéricos positivos retornados nas consultas,
validados como inteiros seguros de JavaScript. Não são o código FIPE.

`fipeCode` tem seis dígitos, hífen e um dígito, preservando os zeros iniciais.
`yearCode` é o código de ano/combustível retornado pelo provedor, como `1998-1`;
não envie apenas o ano. O formato também admite o indicador de zero quilômetro
`32000-1`.

Todas as rotas, exceto `/tabelas`, aceitam somente o parâmetro opcional
`tabela_referencia`, inteiro positivo seguro. Sem ele, a BrasilAPI usa a referência
vigente. Parâmetros extras, repetidos, vazios ou inválidos retornam HTTP 400 antes
de acessar a API externa. A rota `/tabelas` não aceita query parameters.

## Exemplos no Postman

Defina `baseUrl=http://localhost:3000`. Selecione GET, sem Authorization e sem Body.
A API deve estar iniciada com a configuração existente de banco/JWT.

1. `{{baseUrl}}/api/fipe/tabelas`: obtenha uma referência e, se desejar, guarde
   `codigo` em `tabelaReferencia`.
2. `{{baseUrl}}/api/fipe/marcas/carros`: guarde o `valor` da marca escolhida em
   `marcaCodigo`. `/api/fipe/marcas` consulta todos os tipos.
3. `{{baseUrl}}/api/fipe/modelos/carros/{{marcaCodigo}}`: guarde o `valor` do modelo
   em `modeloCodigo`.
4. `{{baseUrl}}/api/fipe/anos/carros/{{marcaCodigo}}/{{modeloCodigo}}`: guarde o
   `valor` do ano/combustível em `anoCodigo`.
5. `{{baseUrl}}/api/fipe/detalhes/carros/{{marcaCodigo}}/{{modeloCodigo}}/{{anoCodigo}}`:
   obtenha o preço de referência e `codigoFipe`.
6. `{{baseUrl}}/api/fipe/preco/{{codigoFipe}}`: consulte a lista de preços para
   esse código. Exemplo de formato de URL: `/api/fipe/preco/001004-9`.

Para uma referência específica, acrescente `?tabela_referencia={{tabelaReferencia}}`
em cada etapa compatível. Use a mesma referência em todo o fluxo e códigos
efetivamente retornados pelo provedor; códigos de exemplos não garantem dados atuais.

## Exemplos de respostas

HTTP 200, sem envelope adicional. Valores abaixo são ilustrativos e não devem ser
interpretados como cotação atual ou combinação real de marca/modelo/código.

Marcas (códigos sempre normalizados para string):

```json
[{ "nome": "Marca de exemplo", "valor": "21" }]
```

Modelos:

```json
[{ "modelo": "Modelo de exemplo 1.0", "valor": "123" }]
```

Anos:

```json
[{ "nome": "2020 Gasolina", "valor": "2020-1" }]
```

Tabelas:

```json
[{ "codigo": 271, "mes": "junho/2021 " }]
```

Preço por código retorna uma lista, pois um código pode ter diferentes anos e
combustíveis. Detalhes retorna um único objeto com o mesmo formato de item:

```json
[
  {
    "valor": "R$ 45.000,00",
    "marca": "Marca de exemplo",
    "modelo": "Modelo de exemplo 1.0",
    "anoModelo": 2020,
    "combustivel": "Gasolina",
    "codigoFipe": "001004-9",
    "mesReferencia": "junho de 2021 ",
    "tipoVeiculo": 1,
    "siglaCombustivel": "G",
    "dataConsulta": "data textual fornecida pela BrasilAPI"
  }
]
```

Datas textuais e preços formatados são preservados. Não há conversão monetária
para `Float`, definição de preço de lance ou gravação no banco. Campos externos
desconhecidos são descartados; somente os campos esperados são retornados.

## Falhas e limites

- Timeout de cinco segundos por consulta, incluindo leitura e parse do body. A
  chamada é abortada e a rota retorna 504. Não há repetição automática ou cache.
- HTTP 400/404 do provedor viram 400/404 com mensagens locais controladas.
- HTTP 429 e falhas HTTP 5xx viram 503; HTTP 408/504 viram 504. Falha de rede vira 503.
- Outros status inesperados, JSON inválido ou incompatibilidade com o contrato
  de resposta retornam 502. Não é retornado o corpo bruto do erro externo.
- O tratamento centralizado preserva esses status e mensagens de `HttpError`;
  erros internos não classificados continuam com resposta genérica 500.
- A integração não envia tokens, cookies ou headers recebidos do usuário à
  BrasilAPI; envia apenas `Accept: application/json`. Redirecionamentos são recusados.

O terminal do backend registra diagnósticos controlados das falhas: categoria,
tempo decorrido, status HTTP externo quando disponível e código de rede de uma
lista permitida. Não registra URL de consulta, corpo externo, headers, mensagens
brutas de exceções, tokens ou credenciais. Esses detalhes não são enviados nas
respostas HTTP. Por exemplo, a mensagem pública de indisponibilidade pode resultar
de HTTP 429 ou 5xx; confira `upstreamStatus` no terminal para distinguir a causa.

Exemplo de erro:

```json
{ "message": "BrasilAPI temporariamente indisponível. Tente novamente." }
```

A BrasilAPI é um serviço externo: disponibilidade, códigos e referências variam.
Não há busca livre por texto, paginação ou filtros adicionais nesta integração,
pois não estão previstos nos endpoints FIPE documentados. Não se deve inferir
que o código do modelo retornado na navegação seja o código FIPE.

A especificação tem uma inconsistência em marcas: declara `valor` como inteiro,
mas o exemplo e a implementação usam string. O backend aceita ambos os formatos
numéricos positivos e devolve string. Os demais contratos são verificados em runtime;
mudanças incompatíveis no provedor exigirão revisão, sem devolver dados fabricados.

`/preco/:fipeCode` retorna várias combinações possíveis, não um único preço universal
por veículo. Para identificar uma versão/ano/combustível, use anos e detalhes.
O preço FIPE é somente referência e não determina preço inicial ou valor de lance.

## Testes

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

Os testes FIPE usam HTTP local e respostas BrasilAPI simuladas, sem conexão externa
ou banco. Cobrem rotas suportadas, mapeamento de URLs, referência opcional, seleção
de campos, formatos de resposta, validação de parâmetros, rede indisponível,
timeout antes e após headers, JSON inválido e erros HTTP. As suítes existentes
de autenticação, leilões e promoção administrativa continuam incluídas.
