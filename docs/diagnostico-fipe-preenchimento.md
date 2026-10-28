# Diagnóstico do preenchimento FIPE — 28/10/2026

O fluxo de aplicação funciona no Chromium com uma resposta válida: selecionar marca,
modelo e ano dispara GET de detalhes; o clique em “Usar dados deste veículo” atualiza
os inputs controlados de `VehicleForm`, pelo estado de `VehicleEditor`. Não foi
reproduzida perda dos valores por efeito, remount ou reset após esse clique.

## Causa e correção

Consultas somente por GET, sem autenticação nem gravação:

- `GET http://localhost:3000/api/fipe/anos/carros/21/4828` retornou HTTP 200,
  incluindo `2014-5` e `2013-5`.
- `GET http://localhost:3000/api/fipe/detalhes/carros/21/4828/2014-5` e a mesma
  consulta para `2013-5` retornaram HTTP 502 com
  `{"message":"A BrasilAPI retornou dados FIPE em formato inválido."}`.
- `GET https://brasilapi.com.br/api/fipe/detalhes/v1/carros/21/4828/2014-5`
  retornou HTTP 200. O objeto está preservado em
  `frontend/tests/fixtures/fipe-palio-2014.json` e não contém `dataConsulta`.

Em `backend/src/modules/fipe/fipe.service.ts`, `price()` exigia `dataConsulta`.
Agora o campo é opcional em detalhes e preços: se ausente, é omitido do JSON;
se presente, deve continuar sendo uma string não vazia. `null`, texto vazio e tipos
inválidos continuam retornando 502. Nenhuma data é fabricada e todos os campos
essenciais mantêm as validações existentes. O frontend não depende desse metadado.

O frontend usava a mensagem genérica de `getJson` sobre leilões, escondendo que a
falha era da consulta FIPE. O serviço FIPE agora apresenta mensagens próprias para
resposta inválida/incompleta, referência ausente, timeout e indisponibilidade,
informando que nenhum dado foi aplicado e oferecendo preenchimento manual.

Após a correção, o endpoint local retornou HTTP 200 sem `dataConsulta`. O teste ao
vivo no Chromium passou pela BrasilAPI, backend local e formulário, conferindo os
valores visíveis e a preservação dos campos manuais. Nenhum veículo foi salvo.

## Testes de navegador

`frontend/tests/vehicle-fipe-browser.test.mjs` monta os componentes reais
`AuctioneerVehiclePage`, `VehicleForm` e `VehicleFipe` no Chromium. Simula as
respostas HTTP e verifica valores dos elementos DOM após selecionar e clicar.
Cobre cadastro, edição, preservação dos campos manuais, 502/503, falha de rede,
resposta incompleta, repetição da consulta, respostas atrasadas, troca de seleção
e anos especiais. Não permite cadastro de veículos nem qualquer gravação real.

Executar em `frontend`:

```powershell
node --test tests/vehicle-fipe-browser.test.mjs
npm.cmd test
npm.cmd run build
# Opcional: consultas reais, backend existente em localhost:3000, sem gravações.
$env:FIPE_LIVE_TESTS='1'
node --test tests/vehicle-fipe-browser.test.mjs
```

O navegador é detectado no cache local do Playwright no Windows, sem dependência
do pacote. Alternativamente, definir `CHROMIUM_PATH` com o executável Chromium
compatível. Sem navegador disponível, os testes de navegador são explicitamente
marcados como ignorados; isso não equivale a validação da interface.

## Verificação manual

1. Abrir “Cadastrar veículo”, preencher descrição, versão e URLs de imagens.
2. Clicar em “Consultar FIPE”; selecionar Fiat (`21`), Palio 1.0 ECONOMY Fire Flex
   8V 4p (`4828`) e 2014 Flex (`2014-5`).
3. Aguardar o resultado e clicar em “Usar dados deste veículo”. Conferir marca,
   modelo, ano, código, preço, mês e códigos FIPE. Descrição, versão e imagens
   devem permanecer intactas.
4. Se a BrasilAPI estiver indisponível ou retornar dados essenciais inválidos,
   conferir o alerta FIPE, sem confirmação de aplicação nem botão habilitado.
5. Repetir na edição: abrir e consultar não devem substituir os dados; somente o
   clique explícito deve aplicar. Não é necessário salvar para verificar.
