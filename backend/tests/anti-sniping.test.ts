import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveLotEndsAt, extendedDeadline } from "../src/modules/lots/lot-deadline";

describe("Fronteiras temporais do anti-sniping", () => {
  const end = new Date("2030-01-01T12:00:00.000Z");
  it("fora da janela não prorroga", () => { assert.equal(extendedDeadline(end, new Date(end.getTime() - 120001)), null); });
  it("exatamente dois minutos mantém o prazo, sem prorrogação real", () => { assert.equal(extendedDeadline(end, new Date(end.getTime() - 120000)), null); });
  it("um milissegundo dentro da janela prorroga um milissegundo", () => { assert.equal(extendedDeadline(end, new Date(end.getTime() - 119999))?.getTime(), end.getTime() + 1); });
  it("um milissegundo antes do fim garante nova janela completa", () => { assert.equal(extendedDeadline(end, new Date(end.getTime() - 1))?.getTime(), end.getTime() + 119999); });
  it("no prazo ou depois dele não ressuscita o lote", () => { assert.equal(extendedDeadline(end, end), null); assert.equal(extendedDeadline(end, new Date(end.getTime() + 1)), null); });
  it("prazo individual prevalece; nulo herda o prazo-base", () => {
    const override = new Date(end.getTime() + 60000);
    assert.equal(effectiveLotEndsAt({ endsAt: null }, { endsAt: end }), end);
    assert.equal(effectiveLotEndsAt({ endsAt: override }, { endsAt: end }), override);
  });
  it("prorrogações sucessivas nunca reduzem o prazo", () => {
    const first = extendedDeadline(end, new Date(end.getTime() - 60000))!;
    const second = extendedDeadline(first, new Date(end.getTime() + 1000))!;
    assert.equal(first.getTime(), end.getTime() + 60000); assert.equal(second.getTime(), end.getTime() + 121000);
    assert.equal(extendedDeadline(second, new Date(end.getTime() - 120000)), null);
  });
});
