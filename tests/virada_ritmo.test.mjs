// node --test tests/virada_ritmo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { vrVirada, vrRitmo, vrSegundos, vrSegIso, vrHora, vrPassou } = require("../src/apuracao/web/virada-ritmo.js");
const perto = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("virada: quanto quem está atrás precisa do que falta", () => {
  // Lula 60 × Flávio 40 no contado; faltam 100 válidos, a projeção espera Lula 45% deles
  const v = vrVirada({ lula: 60, flavio: 40 }, [{ validos_esperados: 100, lula_esperado_pct: 45 }]);
  assert.equal(v.estado, "possivel");
  assert.equal(v.atras, "f");
  perto(v.precisa, 60); // 40 + 60 = 60 + 40 → empate
  perto(v.tem, 40);
  perto(v.espera, 55);
  perto(v.falta, 100);
});

test("virada: soma os grupos e usa o lado de Lula quando ele está atrás", () => {
  const v = vrVirada({ lula: 45, flavio: 55 }, [
    { validos_esperados: 50, lula_esperado_pct: 60 }, { validos_esperados: 150, lula_esperado_pct: 40 }, { validos_esperados: 0, lula_esperado_pct: 99 }]);
  assert.equal(v.atras, "l");
  perto(v.falta, 200);
  perto(v.precisa, 52.5);
  perto(v.espera, 45); // (30 + 60) / 200
});

test("virada: impossível quando precisa de mais de 100%", () => {
  const v = vrVirada({ lula: 100, flavio: 20 }, [{ validos_esperados: 50, lula_esperado_pct: 50 }]);
  assert.equal(v.estado, "impossivel");
  assert.ok(v.precisa > 100);
});

test("virada: casos de borda", () => {
  assert.equal(vrVirada({ lula: 0, flavio: 0 }, []).estado, "vazio");
  assert.equal(vrVirada(null, null).estado, "vazio");
  assert.equal(vrVirada({ lula: 5, flavio: 5 }, [{ validos_esperados: 10, lula_esperado_pct: 50 }]).estado, "empate");
  assert.equal(vrVirada({ lula: 6, flavio: 5 }, []).estado, "fim");
});

test("ritmo: precisa de 3 pontos", () => {
  assert.equal(vrRitmo([]).estado, "cedo");
  assert.equal(vrRitmo([{ s: 0, ap: 1 }, { s: 60, ap: 2 }]).estado, "cedo");
});

test("ritmo: velocidade e hora dos 90%", () => {
  // 1 pp por minuto: 10 pp a cada 10 min; às 18:00 com 30% → 90% às 19:00
  const t0 = 17 * 3600;
  const pts = [0, 10, 20, 30].map((m) => ({ s: t0 + 1800 + m * 60, ap: m }));
  const r = vrRitmo(pts);
  assert.equal(r.estado, "ok");
  perto(r.taxa10, 10);
  perto(r.eta90, 19 * 3600);
  assert.equal(vrHora(r.eta90), "19h00");
  assert.equal(r.passou90, null);
});

test("ritmo: usa só a janela recente", () => {
  // começo rápido, fim lento: a janela de 30 min só vê o lento
  const pts = [{ s: 0, ap: 0 }, { s: 600, ap: 50 }, { s: 3600, ap: 60 }, { s: 4800, ap: 64 }, { s: 6000, ap: 68 }];
  const r = vrRitmo(pts, 1800);
  perto(r.taxa10, 2); // 4 pp em 20 min
});

test("ritmo: sem atualização nova, o ritmo cai; parado vira 'parado'", () => {
  const pts = [{ s: 0, ap: 10 }, { s: 600, ap: 20 }, { s: 1200, ap: 30 }];
  const a = vrRitmo(pts, 1800, 3, 1200 + 600);
  assert.equal(a.semNovo, true);
  perto(a.taxa10, (20 / 1800) * 600);
  const b = vrRitmo(pts, 1800, 3, 1200 + 3 * 3600);
  assert.equal(b.estado, "parado");
  assert.equal(b.ultimo.s, 1200);
  const c = vrRitmo(pts, 1800, 3, 1200 + 100); // menos de 5 min: ainda não conta
  assert.ok(!c.semNovo);
});

test("ritmo: depois dos 90% e no fim", () => {
  const pts = [{ s: 0, ap: 80 }, { s: 600, ap: 88 }, { s: 1200, ap: 92 }];
  const r = vrRitmo(pts);
  perto(r.passou90, 900);
  assert.equal(r.eta90, undefined);
  assert.equal(vrRitmo([...pts, { s: 1800, ap: 100 }]).estado, "fim");
});

test("ritmo lento demais não chuta hora", () => {
  const pts = [{ s: 0, ap: 10 }, { s: 600, ap: 10.01 }, { s: 1200, ap: 10.02 }];
  assert.equal(vrRitmo(pts).eta90, null);
});

test("horas: hg vira segundos contínuos, passando da meia-noite", () => {
  assert.deepEqual(vrSegundos(["23:50:00", "23:59:30", "00:05:00"]), [85800, 86370, 86700]);
  assert.deepEqual(vrSegundos(["17:21:00", "16:29:30"]), [62460, 59370]); // recuo pequeno não é meia-noite
  assert.equal(vrSegundos(["x"])[0], null);
  assert.equal(vrSegIso("2026-10-25T17:00:30") - vrSegIso("2026-10-25T16:59:30"), 60);
  assert.equal(vrHora(86700), "00h05");
  perto(vrPassou([{ s: 0, ap: 0 }, { s: 100, ap: 100 }], 90), 90);
});
