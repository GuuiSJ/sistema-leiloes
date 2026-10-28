import assert from 'node:assert/strict'
import { after, before, it } from 'node:test'
import { createServer } from 'vite'
import { chromiumPath, openChromium } from './helpers/chromium.mjs'

const executable = await chromiumPath()
let server, browser, base
before(async () => {
  if (!executable) return
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, ws: false, proxy: { '/api/fipe': 'http://localhost:3000' } }, plugins: [{
    name: 'vehicle-fipe-browser-test',
    configureServer(vite) {
      vite.middlewares.use('/__vehicle-fipe-test', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(await vite.transformIndexHtml('/__vehicle-fipe-test', '<!doctype html><html lang="pt-BR"><body><div id="root"></div><script type="module" src="/tests/helpers/vehicle-fipe-browser.tsx"></script></body></html>'))
      })
    },
  }] })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}/__vehicle-fipe-test`
  browser = await openChromium(executable)
})
after(async () => { browser?.close(); await server?.close() })
const options = { skip: !executable && 'Set CHROMIUM_PATH to run the real browser integration tests', timeout: 60000 }
const button = text => `[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)})`
const value = name => `document.querySelector('[name="${name}"]').value`
async function click(text) { await browser.evaluate(`${button(text)}.click()`) }
async function fill(name, text) {
  await browser.evaluate(`(() => {
    const input = document.querySelector('[name="${name}"]');
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
}
async function select(index, selected) {
  await browser.wait(`document.querySelectorAll('select')[${index}] && !document.querySelectorAll('select')[${index}].disabled`)
  await browser.evaluate(`(() => { const s = document.querySelectorAll('select')[${index}]; s.value = ${JSON.stringify(selected)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
}
async function open(editing = false) {
  await browser.navigate(base + (editing ? '?edit' : ''))
  await browser.wait(`!!document.querySelector('[name="brand"]')`)
  await click('Consultar FIPE')
  await select(0, '21'); await select(1, '4828')
}
async function ready() { await browser.wait(`${button('Usar dados deste veículo')} && !${button('Usar dados deste veículo')}.disabled`) }

it('real Chromium: selecting FIPE and confirming fills visible fields through the actual parent page', options, async () => {
  for (const editing of [false, true]) {
    await open(editing)
    if (!editing) {
      await fill('description', 'Descrição manual')
      await fill('version', 'Versão manual')
      await fill('imageUrls', 'https://example.test/manual.jpg')
    }
    await select(2, '2014-5'); await ready()
    assert.equal(await browser.evaluate(value('brand')), editing ? 'Marca original' : '')
    await click('Usar dados deste veículo')
    await browser.wait(`${value('brand')} === 'Fiat'`)
    for (const [name, expected] of Object.entries({ brand: 'Fiat', model: 'Palio 1.0 ECONOMY Fire Flex 8V 4p', year: '2014', fipeCode: '001267-0', fipeReferencePrice: '32125,00', fipeReferenceMonth: 'outubro de 2026', fipeBrandCode: '21', fipeModelCode: '4828', fipeYearCode: '2014-5' })) {
      assert.equal(await browser.evaluate(value(name)), expected, name)
    }
    assert.equal(await browser.evaluate(value('description')), 'Descrição manual')
    assert.equal(await browser.evaluate(value('version')), 'Versão manual')
    assert.equal(await browser.evaluate(value('imageUrls')), 'https://example.test/manual.jpg')
    assert.equal(await browser.evaluate('window.fipeTest.writes'), 0)
    assert.equal(await browser.evaluate('document.body.innerText.includes("Dados do veículo preenchidos pela consulta FIPE.")'), true)
  }
})

it('real Chromium: errors and incomplete responses never enable applying or claim success', options, async () => {
  for (const mode of ['502', '503', 'offline', 'incomplete']) {
    await open(true)
    await browser.evaluate(`window.fipeTest.mode = ${JSON.stringify(mode)}`)
    await select(2, '2014-5')
    await browser.wait(`!!document.querySelector('[role="alert"]')`)
    assert.equal(await browser.evaluate(`${button('Usar dados deste veículo')}?.disabled ?? true`), true)
    assert.equal(await browser.evaluate(value('brand')), 'Marca original')
    assert.equal(await browser.evaluate('document.body.innerText.includes("Dados do veículo preenchidos pela consulta FIPE.")'), false)
    assert.match(await browser.evaluate('document.querySelector("[role=alert]").textContent'), /FIPE/)
    assert.doesNotMatch(await browser.evaluate('document.querySelector("[role=alert]").textContent'), /leilões/)
    if (mode === '502') assert.match(await browser.evaluate('document.querySelector("[role=alert]").textContent'), /inválidos ou incompletos/)
    await browser.evaluate('window.fipeTest.mode = "success"')
    await click('Repetir consulta FIPE'); await ready()
    assert.equal(await browser.evaluate(value('brand')), 'Marca original')
    await click('Usar dados deste veículo')
    await browser.wait(`${value('brand')} === 'Fiat'`)
  }
})

it('real Chromium: changed selections discard pending details and special years cannot be applied', options, async () => {
  await open()
  await browser.evaluate('window.fipeTest.mode = "delayed"')
  await select(2, '2014-5')
  await browser.wait('!!window.fipeTest.release')
  assert.equal(await browser.evaluate(`${button('Usar dados deste veículo')}?.disabled ?? true`), true)
  await select(0, '59')
  await browser.evaluate('window.fipeTest.release(); window.fipeTest.mode = "success"')
  await browser.wait('document.querySelectorAll("select")[1].value === "" && document.querySelectorAll("select")[2].value === ""')
  assert.equal(await browser.evaluate(`${button('Usar dados deste veículo')}?.disabled ?? true`), true)
  await select(1, '4828'); await select(2, '2013-5'); await ready()
  await select(1, '4829')
  await browser.wait('document.querySelectorAll("select")[2].value === ""')
  assert.equal(await browser.evaluate(`${button('Usar dados deste veículo')}?.disabled ?? true`), true)
  await select(2, '2014-5'); await ready()
  await select(2, '2013-5'); await ready(); await click('Usar dados deste veículo')
  await browser.wait(`${value('year')} === '2013'`)
  await select(2, '32000-5')
  await browser.wait('document.body.innerText.includes("ano especial")')
  assert.equal(await browser.evaluate(`${button('Usar dados deste veículo')}.disabled`), true)
  assert.equal(await browser.evaluate(value('year')), '2013')
  assert.equal(await browser.evaluate('window.fipeTest.writes'), 0)
})

it('live BrasilAPI → backend → Chromium: fills visible fields without saving a vehicle', {
  ...options, skip: options.skip || (process.env.FIPE_LIVE_TESTS !== '1' && 'Opt in with FIPE_LIVE_TESTS=1; requires backend on localhost:3000 and BrasilAPI access'),
}, async () => {
  await browser.navigate(base + '?live')
  await browser.wait(`!!document.querySelector('[name="brand"]')`)
  await fill('description', 'Descrição manual')
  await fill('version', 'Versão manual')
  await fill('imageUrls', 'https://example.test/manual.jpg')
  await click('Consultar FIPE')
  await select(0, '21'); await select(1, '4828'); await select(2, '2014-5')
  await ready()
  const detail = await browser.evaluate('window.fipeTest.liveDetails')
  assert(detail)
  assert.equal(await browser.evaluate(value('brand')), '')
  await click('Usar dados deste veículo')
  await browser.wait(`${value('brand')} === ${JSON.stringify(detail.marca)}`)
  for (const [name, expected] of Object.entries({ brand: detail.marca, model: detail.modelo, year: String(detail.anoModelo), fipeCode: detail.codigoFipe, fipeReferencePrice: detail.valor.replace(/^R\$\s*/, '').replaceAll('.', ''), fipeReferenceMonth: detail.mesReferencia, fipeBrandCode: '21', fipeModelCode: '4828', fipeYearCode: '2014-5' })) {
    assert.equal(await browser.evaluate(value(name)), expected, name)
  }
  for (const [name, expected] of Object.entries({ description: 'Descrição manual', version: 'Versão manual', imageUrls: 'https://example.test/manual.jpg' })) assert.equal(await browser.evaluate(value(name)), expected)
  assert.equal(await browser.evaluate('window.fipeTest.writes'), 0)
  assert.equal(await browser.evaluate('document.body.innerText.includes("Dados do veículo preenchidos pela consulta FIPE.")'), true)
})
