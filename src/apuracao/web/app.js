"use strict";

const POLL_MS = 10000;
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("pt-BR");
const fmtN = (x) => (x == null || Number.isNaN(x) ? "—" : nf.format(Math.round(x)));
const fmtP = (x, d = 2) => (x == null || Number.isNaN(x) ? "—" : x.toFixed(d).replace(".", ",") + "%");
const fmtPP = (x, d = 2) => (x == null || Number.isNaN(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d).replace(".", ",") + " pp");
const fmtS = (x) => (x == null ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + nf.format(Math.abs(Math.round(x))));
const sinal = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
const hora = (iso) => (iso ? iso.slice(11, 16) : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const MODELOS = [
  { id: "vs_2026_1t", curto: "1º turno 2026", base: "Lula no 1º turno + parte estimada dos votos dos outros candidatos" },
  { id: "vs_2022_2t", curto: "2º turno 2022", base: "Lula × Bolsonaro no 2º turno de 2022" },
];
let modelo = ls.get("modelo", "vs_2026_1t");
let aba = (location.hash || "#brasil").slice(1);
const expandido = {};
let EST = null;
const nomeModelo = () => MODELOS.find((m) => m.id === modelo).curto;
const outroModelo = () => MODELOS.find((m) => m.id !== modelo).id;

function kpi(k, v, d = "") {
  return `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ""}</div>`;
}

// ---------------------------------------------------------------- abas e seletores
function initUI() {
  document.querySelectorAll(".abas button").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.aba)));
  for (const id of ["seg-brasil", "seg-exterior"]) {
    $(id).innerHTML = MODELOS.map((m) => `<button data-m="${m.id}">Base ${m.curto}</button>`).join("");
    $(id).addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      modelo = b.dataset.m; ls.set("modelo", modelo); if (EST) render(EST);
    });
  }
  window.addEventListener("hashchange", () => irPara((location.hash || "#brasil").slice(1), false));
  irPara(aba, false);
}
function irPara(a, push = true) {
  if (!["brasil", "exterior", "mercados", "coleta"].includes(a)) a = "brasil";
  aba = a;
  if (push) history.replaceState(null, "", "#" + a);
  document.querySelectorAll(".abas button").forEach((b) => b.setAttribute("aria-selected", b.dataset.aba === a));
  document.querySelectorAll(".aba").forEach((s) => (s.hidden = s.id !== "aba-" + a));
  if (EST) render(EST);
}

// ---------------------------------------------------------------- blocos de placar
function duelo(lPct, lVotos, fVotos) {
  return `<div class="duelo">
      <div class="lado"><span class="nome">Lula · 13</span><span class="pct l">${fmtP(lPct)}</span><span class="votos">${lVotos == null ? "" : fmtN(lVotos) + " votos"}</span></div>
      <div class="lado dir"><span class="nome">Flávio · 22</span><span class="pct f">${fmtP(lPct == null ? null : 100 - lPct)}</span><span class="votos">${fVotos == null ? "" : fmtN(fVotos) + " votos"}</span></div>
    </div>
    <div class="barra"><div class="bl" style="width:${lPct ?? 50}%"></div><div class="bf"></div><div class="meio"></div></div>`;
}

function regua(p) {
  const lo = Math.min(45, Math.floor(p.p10 - 1)), hi = Math.max(55, Math.ceil(p.p90 + 1));
  const x = (v) => (100 * (v - lo)) / (hi - lo);
  return `<div class="regua" title="Faixa de 80%: ${fmtP(p.p10)} a ${fmtP(p.p90)}">
    <div class="eixo"></div><div class="cinquenta" style="left:${x(50)}%"></div>
    <div class="int" style="left:${x(p.p10)}%;width:${x(p.p90) - x(p.p10)}%"></div>
    <div class="med" style="left:calc(${x(p.lula_pct)}% - 1px)"></div>
    ${[lo, 50, hi].map((t) => `<span class="tk" style="left:${x(t)}%">${t}%</span>`).join("")}
  </div>`;
}

function blocoContado(titulo, rotulo, lula, validos, extra) {
  const pl = validos ? (100 * lula) / validos : null;
  return `<div class="bloco"><div class="rotulo">${rotulo}</div><div class="titulo">${titulo}</div>
    ${validos ? duelo(pl, lula, validos - lula) : `<div class="indisp">Ainda sem votos contados.</div>`}
    <div class="rodape-bloco">${extra || ""}</div></div>`;
}

function blocoProjecao(p, escopo, outro, mk) {
  const min = escopo === "br" ? 5 : 2;
  if (!p || p.lula_pct == null || !p.disponivel) {
    const ap = p ? 100 * p.apurado_eleitorado : 0;
    return `<div class="bloco destaque"><div class="rotulo">Projeção do resultado final</div>
      <div class="indisp">A projeção aparece com ${min}% do eleitorado apurado. Agora: <b>${fmtP(ap)}</b>.
      ${escopo === "br" ? "Antes das 17h só há votos do exterior, que não dizem nada sobre o Brasil." : ""}
      <div class="prog"><i style="width:${Math.min(100, (100 * ap) / min)}%"></i></div></div>
      ${mk || ""}</div>`;
  }
  const lado = p.margem_votos >= 0 ? "Lula" : "Flávio";
  return `<div class="bloco destaque"><div class="rotulo">Projeção do resultado final · base ${nomeModelo()}</div>
    ${duelo(p.lula_pct, null, null)}
    ${regua(p)}
    <div class="rodape-bloco">
      <span>Faixa de 80%: <b>${fmtP(p.p10)} a ${fmtP(p.p90)}</b></span>
      <span>Chance de Lula: <b>${fmtP(p.prob_lula, 0)}</b></span>
      <span>${lado} por <b>${fmtN(Math.abs(p.margem_votos))}</b> votos</span>
      <span>Abstenção projetada: <b>${fmtP(p.abstencao_final_pct, 1)}</b></span>
    </div>
    ${outro && outro.lula_pct != null ? `<div class="muted">Com a outra base: Lula ${fmtP(outro.lula_pct)} (faixa ${fmtP(outro.p10, 1)}–${fmtP(outro.p90, 1)}).</div>` : ""}
    ${mk || ""}</div>`;
}

function linhaMercados(pm, k, oque) {
  if (pm == null && k == null) return "";
  return `<div class="muted">Mercados, ${oque}: Polymarket <b>${fmtP(pm == null ? null : 100 * pm, 0)}</b> · Kalshi <b>${fmtP(k == null ? null : 100 * k, 0)}</b></div>`;
}

// ---------------------------------------------------------------- explicação
function ledger(p, unidade) {
  if (!p || !p.contado || p.lula_pct == null) return `<div class="vazio">A decomposição aparece junto com a projeção.</div>`;
  const c = p.contado, e = p.estimado;
  const L = c.lula + e.lula, F = c.flavio + e.flavio, top = Math.max(L, F) || 1;
  const w = (v) => (100 * v) / top;
  const linha = (quem, cls, cv, ev, tot) => `
    <div class="quem">${quem}</div>
    <div class="trilho"><div class="seg-c ${cls}" style="left:0;width:${w(cv)}%"></div><div class="seg-e ${cls}" style="left:calc(${w(cv)}% + 2px);width:${w(ev)}%"></div></div>
    <div class="conta">contado <b>${fmtN(cv)}</b> + estimado <b>${fmtN(ev)}</b> = <b>${fmtN(tot)}</b> votos</div>`;
  return `<div class="legenda"><span><i></i>já contado</span><span><i class="e"></i>estimado para o que falta ${unidade}</span></div>
    <div class="ledger">${linha("Lula", "l", c.lula, e.lula, L)}${linha("Flávio", "f", c.flavio, e.flavio, F)}</div>
    <div class="saldo">Saldo projetado: <b>${L >= F ? "Lula" : "Flávio"} por ${fmtN(Math.abs(L - F))}</b> votos, de ${fmtN(L + F)} válidos.
    O contado sozinho dá ${fmtP((100 * c.lula) / (c.validos || 1))} para Lula; o que falta, estimado, dá ${fmtP((100 * e.lula) / (e.validos || 1))}.</div>`;
}

function passos(p, escopo) {
  if (!p || p.lula_pct == null) return "";
  const m = MODELOS.find((x) => x.id === modelo);
  const c = p.contado, e = p.estimado, mu = p.municipios || {};
  const br = escopo === "br";
  const unid = br ? "município" : "cidade", unids = br ? "municípios" : "cidades";
  const g = br ? { compl: "completos", cont: "os municípios contados", cada: "cada município", Cada: "Cada município" }
               : { compl: "completas", cont: "as cidades contadas", cada: "cada cidade", Cada: "Cada cidade" };
  const parcial = (100 * c.lula) / (c.validos || 1);
  let chips = "";
  if (p.alpha_regiao) {
    chips = `<p>Dos votos dos outros candidatos do 1º turno, a parte que foi para Lula nas urnas contadas:</p>
      <div class="chips">${Object.entries(p.alpha_regiao).map(([r, a]) => `<span class="chip">${r} ${fmtP(a, 0)}</span>`).join("")}</div>`;
  }
  if (br && p.swing_uf) {
    const top = Object.entries(p.swing_uf).filter(([g]) => g !== "zz").sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
    if (top.length) chips += `<p>Maiores desvios por estado:</p><div class="chips">${top.map(([g, v]) => `<span class="chip">${g.toUpperCase()} ${fmtPP(v, 1)}</span>`).join("")}</div>`;
  }
  const absRest = e.eleitorado ? 100 * (1 - e.comparecimento / e.eleitorado) : null;
  return `
    <div class="passo"><span class="n">1</span><span class="t">O que já foi contado</span>
      <div class="big">${fmtP(100 * p.apurado_eleitorado, 1)}</div>
      <p>do eleitorado. ${fmtN(mu.completos)} ${unids} ${g.compl}, ${fmtN(mu.parciais)} parciais e ${fmtN(mu.sem_dados)} ainda sem nada.</p>
      <p>Nesses votos, Lula tem <b>${fmtP(parcial)}</b>. Ainda não é o resultado: quem chega primeiro não representa o todo.</p></div>
    <div class="passo"><span class="n">2</span><span class="t">Quanto Lula se desviou da base</span>
      <div class="big">${fmtPP(p.desvio_medio_pp)}</div>
      <p>Base de ${g.cada}: ${m.base}. ${br ? "Cada município contado é comparado" : "Cada cidade contada é comparada"} com a própria base, então a geografia de quem chegou primeiro não engana.</p>
      ${chips}</div>
    <div class="passo"><span class="n">3</span><span class="t">Aplicamos no que falta</span>
      <div class="big">${fmtN(e.eleitorado)}</div>
      <p>eleitores ainda não contados. Esperamos ${fmtN(e.comparecimento)} votantes (abstenção ${fmtP(absRest, 1)}) e ${fmtN(e.validos)} votos válidos.</p>
      <p>${g.Cada} recebe a sua base + o desvio ${br ? "do seu estado (puxado para a média da região quando o estado tem poucos votos)" : "médio do exterior"}. Lula fica com <b>${fmtP((100 * e.lula) / (e.validos || 1))}</b> desses votos.</p></div>
    <div class="passo"><span class="n">4</span><span class="t">E a incerteza</span>
      <div class="big">${fmtP(p.prob_lula, 0)}</div>
      <p>de chance de Lula. Simulamos ${br ? 300 : 200} cenários, sorteando de novo ${g.cont} e somando um desvio extra a cada ${br ? "estado" : "grupo"} que ainda falta (±${fmtP(100 * p.tau, 1)}).</p>
      <p>Em 80% deles Lula fica entre <b>${fmtP(p.p10)}</b> e <b>${fmtP(p.p90)}</b>. A faixa fecha conforme a apuração avança.</p></div>`;
}

function tabelaGrupos(id, grupos, rotulo) {
  if (!grupos || !grupos.length) return `<div class="vazio">Aparece junto com a projeção.</div>`;
  const max = Math.max(...grupos.map((g) => Math.abs(g.saldo_esperado))) || 1;
  const lista = expandido[id] ? grupos : grupos.slice(0, 12);
  const linhas = lista.map((g) => {
    const w = (50 * Math.abs(g.saldo_esperado)) / max;
    const bar = g.saldo_esperado >= 0 ? `left:50%;width:${w}%;background:var(--lula)` : `left:${50 - w}%;width:${w}%;background:var(--flavio)`;
    return `<tr><td>${esc(g.nome)}</td><td>${fmtP(g.apurado_pct, 1)}</td><td>${fmtP(g.lula_contado_pct, 1)}</td>
      <td>${fmtP(g.base_pct, 1)}</td><td class="${sinal(g.desvio_pp)}">${fmtPP(g.desvio_pp, 1)}</td><td><b>${fmtP(g.lula_esperado_pct, 1)}</b></td>
      <td>${fmtN(g.validos_esperados)}</td><td class="${sinal(g.saldo_esperado)}">${fmtS(g.saldo_esperado)}<span class="div"><i style="${bar}"></i></span></td>
      <td>${fmtP(g.lula_final_pct, 1)}</td></tr>`;
  }).join("");
  return `<div class="tabela-wrap"><table>
    <tr><th>${rotulo}</th><th>Apurado</th><th title="Lula entre os válidos já contados">Lula no contado</th>
      <th title="O que a base prevê para Lula nos votos que faltam">Base no que falta</th>
      <th title="Desvio aplicado sobre a base (vem das urnas já contadas)">Desvio</th>
      <th title="Base + desvio: o que esperamos de Lula nos votos que faltam">Lula no que falta</th>
      <th>Válidos que faltam</th><th title="Votos de Lula menos votos de Flávio esperados no que falta">Saldo esperado</th>
      <th title="Contado + estimado">Final projetado</th></tr>${linhas}</table></div>
    ${grupos.length > 12 ? `<button class="mais" data-exp="${id}">${expandido[id] ? "Mostrar só os 12 maiores" : `Mostrar todos (${grupos.length})`}</button>` : ""}`;
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-exp]"); if (!b) return;
  expandido[b.dataset.exp] = !expandido[b.dataset.exp]; if (EST) render(EST);
});

function tabelaMesmas(m, rotuloAtual) {
  if (!m || !m.validos) return `<div class="vazio">Ainda sem urnas apuradas.</div>`;
  const t1 = m["2026_1t"], v1 = m["2022_1t"], v2 = m["2022_2t"];
  const linha = (nome, lula, dir, outros, abst, l2) =>
    `<tr><td>${nome}</td><td>${fmtP(lula)}</td><td>${fmtP(dir)}</td><td>${outros == null ? "—" : fmtP(outros)}</td><td>${fmtP(l2)}</td><td>${fmtP(abst)}</td></tr>`;
  const dl = t1 ? m.lula - t1.lula : null, df = t1 ? m.flavio - t1.direita : null;
  return `<div class="tabela-wrap"><table>
    <tr><th></th><th>Lula</th><th>Flávio / Bolsonaro</th><th>Outros</th><th title="Só entre Lula e o candidato da direita">Lula × direita</th><th>Abstenção</th></tr>
    ${linha(rotuloAtual, m.lula_pct, 100 - m.lula_pct, null, m.abstencao_pct, m.lula_pct)}
    ${t1 ? linha("1º turno 2026", t1.lula_pct, t1.direita_pct, 100 - t1.lula_pct - t1.direita_pct, t1.abstencao_pct, t1.lula_2v_pct) : ""}
    ${v2 ? linha("2º turno 2022", v2.lula_pct, v2.direita_pct, null, v2.abstencao_pct, v2.lula_2v_pct) : ""}
    ${v1 ? linha("1º turno 2022", v1.lula_pct, v1.direita_pct, 100 - v1.lula_pct - v1.direita_pct, v1.abstencao_pct, v1.lula_2v_pct) : ""}
  </table></div>
  <div class="kpis" style="margin-top:12px">
    ${kpi("Lula desde o 1º turno", `<span class="${sinal(dl)}">${fmtS(dl)}</span>`, "votos nas mesmas urnas")}
    ${kpi("Flávio desde o 1º turno", `<span class="${sinal(-df)}">${fmtS(df)}</span>`, "votos nas mesmas urnas")}
    ${t1 ? kpi("Lula × 1º turno (2 candidatos)", fmtPP(m.lula_pct - t1.lula_2v_pct), "pontos percentuais") : ""}
    ${v2 ? kpi("Lula × 2º turno 2022", fmtPP(m.lula_pct - v2.lula_2v_pct), "pontos percentuais") : ""}
    ${t1 ? kpi("Abstenção × 1º turno", fmtPP(m.abstencao_pct - t1.abstencao_pct), "") : ""}
    ${v2 ? kpi("Abstenção × 2º turno 2022", fmtPP(m.abstencao_pct - v2.abstencao_pct), "") : ""}
  </div>`;
}

// ---------------------------------------------------------------- gráfico de linhas com faixa
function grafico(el, cfg) {
  const series = cfg.series.filter((s) => s.pts && s.pts.length);
  const comDados = series.filter((s) => s.pts.length >= 2);
  if (!comDados.length) { el.style.height = "auto"; el.innerHTML = `<div class="vazio">${cfg.vazio || "Aguardando dados."}</div>`; return; }
  el.style.height = "";
  const W = el.clientWidth || 700, H = (el.clientHeight || 280) - 26, m = { l: 46, r: 16, t: 12, b: 24 };
  const xs = series.flatMap((s) => s.pts.map((p) => p.x));
  const ys = series.flatMap((s) => s.pts.flatMap((p) => [p.y, p.lo, p.hi].filter((v) => v != null)));
  (cfg.refs || []).forEach((r) => ys.push(r.y));
  const x0 = cfg.xMin ?? Math.min(...xs), x1 = cfg.xMax ?? Math.max(...xs);
  let y0 = cfg.yMin ?? Math.min(...ys), y1 = cfg.yMax ?? Math.max(...ys);
  if (cfg.yMin == null || cfg.yMax == null) { const pad = Math.max(1, (y1 - y0) * 0.1); if (cfg.yMin == null) y0 = Math.floor(y0 - pad); if (cfg.yMax == null) y1 = Math.ceil(y1 + pad); }
  const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const passo = [1, 2, 5, 10, 20, 25].find((p) => (y1 - y0) / p <= 6) || 25;
  const ticks = []; for (let v = Math.ceil(y0 / passo) * passo; v <= y1; v += passo) ticks.push(v);
  const yFmt = cfg.yFmt || ((v) => String(v).replace(".", ",") + "%");
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="${esc(cfg.aria || "gráfico")}">`;
  svg += ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${yFmt(v)}</text>`).join("");
  (cfg.refs || []).forEach((r) => {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${r.cor || "var(--ref)"}" stroke-dasharray="4 3"/>`;
    if (r.label) svg += `<text x="${m.l + 4}" y="${Y(r.y) - 4}" font-size="11" fill="var(--muted)">${esc(r.label)}</text>`;
  });
  (cfg.vrefs || []).forEach((r) => {
    svg += `<line x1="${X(r.x)}" x2="${X(r.x)}" y1="${m.t}" y2="${H - m.b}" stroke="${r.cor || "var(--ref)"}" ${r.solida ? 'stroke-width="2"' : 'stroke-dasharray="4 3"'}/>`;
    if (r.label) svg += `<text x="${X(r.x) + 4}" y="${m.t + 10}" font-size="11" fill="var(--text-2)">${esc(r.label)}</text>`;
  });
  for (const s of series) {
    if (!s.banda) continue;
    const bp = s.pts.filter((p) => p.lo != null && p.hi != null);
    if (bp.length < 2) continue;
    const d = bp.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.hi).toFixed(1)}`).join("") +
      bp.slice().reverse().map((p) => `L${X(p.x).toFixed(1)},${Y(p.lo).toFixed(1)}`).join("") + "Z";
    svg += `<path d="${d}" fill="${s.cor}" opacity=".16"/>`;
  }
  const rotulos = [];
  for (const s of series) {
    const d = s.pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    svg += `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2" stroke-linejoin="round"/>`;
    const u = s.pts[s.pts.length - 1];
    svg += `<circle cx="${X(u.x)}" cy="${Y(u.y)}" r="4" fill="${s.cor}" stroke="var(--surface)" stroke-width="2"/>`;
    rotulos.push({ x: X(u.x), y: Y(u.y), t: `${s.nome} ${yFmt(+u.y.toFixed(1))}` });
  }
  rotulos.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rotulos.length; i++) if (rotulos[i].y - rotulos[i - 1].y < 14) rotulos[i].y = rotulos[i - 1].y + 14;
  for (const r of rotulos) {
    const fim = r.x > W - 130;
    svg += `<text x="${fim ? r.x - 8 : r.x + 8}" y="${r.y + (fim ? -8 : 4)}" font-size="11" font-weight="600" fill="var(--text)" text-anchor="${fim ? "end" : "start"}">${esc(r.t)}</text>`;
  }
  const xFmt = cfg.xFmt || ((v) => v);
  svg += `<text x="${m.l}" y="${H - 6}" font-size="11" fill="var(--muted)">${esc(xFmt(x0))}</text><text x="${W - m.r}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(xFmt(x1))}</text>`;
  svg += `<line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--ref)" visibility="hidden"/>`;
  svg += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg>`;
  el.innerHTML = svg + `<div class="leg-graf">${series.map((s) => `<span style="--c:${s.cor}">${esc(s.nome)}</span>${s.banda ? `<span class="faixa" style="--c:${s.cor}">faixa de 80%</span>` : ""}`).join("")}</div>`;
  const sv = el.querySelector("svg"), cruz = sv.querySelector(".cruz"), tip = $("tooltip");
  sv.addEventListener("mousemove", (ev) => {
    const r = sv.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W;
    const base = comDados[0].pts;
    let bi = 0; for (let i = 1; i < base.length; i++) if (Math.abs(X(base[i].x) - px) < Math.abs(X(base[bi].x) - px)) bi = i;
    const xv = base[bi].x; cruz.setAttribute("x1", X(xv)); cruz.setAttribute("x2", X(xv)); cruz.setAttribute("visibility", "visible");
    const linhas = series.map((s) => {
      let j = 0; for (let i = 1; i < s.pts.length; i++) if (Math.abs(s.pts[i].x - xv) < Math.abs(s.pts[j].x - xv)) j = i;
      const p = s.pts[j];
      return `<div><span style="color:${s.cor}">●</span> ${esc(s.nome)} <b>${yFmt(+p.y.toFixed(2))}</b>${p.lo != null ? ` <span class="muted">(${yFmt(+p.lo.toFixed(1))} a ${yFmt(+p.hi.toFixed(1))})</span>` : ""}</div>`;
    }).join("");
    tip.hidden = false; tip.style.left = Math.min(ev.clientX + 14, innerWidth - 250) + "px"; tip.style.top = ev.clientY + 14 + "px";
    tip.innerHTML = `<div class="muted">${esc(xFmt(xv))}${base[bi].extra ? " · " + esc(base[bi].extra) : ""}</div>${linhas}`;
  });
  sv.addEventListener("mouseleave", () => { tip.hidden = true; cruz.setAttribute("visibility", "hidden"); });
}
const tms = (iso) => new Date(iso).getTime();
const fmtHora = (ms) => new Date(ms).toTimeString().slice(0, 5);

// ---------------------------------------------------------------- Brasil
function renderBrasil(est) {
  const b = est.brasil || {}, P = b.modelos || {}, p = P[modelo], outro = P[outroModelo()];
  const n = est.nacional, mk = est.mercados || {};
  const esq = est.fase === "apurando"
    ? blocoContado("Totalização oficial do TSE", `Contado agora · ${fmtP(n.apurado_pct)} das seções · TSE ${n.hg}`, n.lula, n.validos,
        `<span>Comparecimento <b>${fmtN(n.comparecimento)}</b></span><span>Abstenção <b>${fmtP(n.abstencao_pct, 1)}</b></span><span>Brancos <b>${fmtP(n.brancos_pct, 1)}</b></span><span>Nulos <b>${fmtP(n.nulos_pct, 1)}</b></span>`)
    : `<div class="bloco"><div class="rotulo">Contado agora</div><div class="titulo">O TSE começa a totalizar às 17h (Brasília)</div>
        <div class="indisp">Até lá, só o exterior tem votos, contados boletim a boletim na aba <a href="#exterior">Exterior</a>
        (${fmtN(est.exterior?.secoes)} de ${fmtN(est.exterior?.secoes_tot)} seções).</div></div>`;
  $("br-placar").innerHTML = esq + blocoProjecao(p, "br", outro, linhaMercados(mk.polymarket?.p_lula, mk.kalshi?.p_lula, "chance de Lula vencer"));
  const ok = p && p.disponivel && p.lula_pct != null;
  $("br-explica-sub").textContent = ok ? `base ${nomeModelo()}` : "";
  $("br-ledger").innerHTML = ok ? ledger(p, "do Brasil") : `<div class="vazio">Aparece com 5% do eleitorado apurado. Enquanto isso, o mesmo método já roda na aba <a href="#exterior">Exterior</a>.</div>`;
  $("br-passos").innerHTML = ok ? passos(p, "br") : "";
  $("br-grupos").innerHTML = ok ? tabelaGrupos("br-g", p.por_uf, "Estado") : `<div class="vazio">Aparece com a projeção.</div>`;
  const hist = (b.hist || []).filter((h) => h.modelo === modelo);
  $("br-conv-sub").textContent = hist.length ? `${hist.length} atualizações do TSE` : "começa às 17h";
  grafico($("br-conv"), {
    aria: "Projeção e contado ao longo da apuração", vazio: "Começa às 17h, com a primeira totalização do TSE. Abaixo, o mesmo gráfico no ensaio com 2022.",
    xFmt: (v) => fmtP(v, 0) + " apurado", xMin: 0, refs: [{ y: 50, label: "50%" }],
    series: [
      { nome: "Contado", cor: "var(--parcial)", pts: hist.map((h) => ({ x: h.apurado, y: h.parcial })) },
      { nome: "Projeção", cor: "var(--lula)", banda: true, pts: hist.map((h) => ({ x: h.apurado, y: h.p50, lo: h.p10, hi: h.p90 })) },
    ],
  });
  const en = est.ensaio_2022;
  if (en && en.pontos?.length) {
    if (!$("br-ensaio-g")) {
      $("br-ensaio").innerHTML = `<div class="ensaio"><h3>Como o método se saiu em 2022</h3>
        <p class="muted" style="margin:0 0 8px">Ensaio com a apuração do 2º turno de 2022 refeita zona a zona, cidades pequenas primeiro (como na noite real), com o 1º turno como base.
        O contado começou com Lula em ${fmtP(en.pontos[0].parcial, 1)} e foi caindo; a projeção ficou perto do resultado real (${fmtP(en.real)}) desde o começo.</p>
        <div id="br-ensaio-g" class="grafico" style="height:230px"></div></div>`;
    }
    grafico($("br-ensaio-g"), {
      aria: "Ensaio com 2022", xFmt: (v) => fmtP(v, 0) + " apurado", xMin: 0, xMax: 100,
      refs: [{ y: en.real, label: `real ${fmtP(en.real)}`, cor: "var(--text-2)" }],
      series: [
        { nome: "Contado", cor: "var(--parcial)", pts: en.pontos.map((h) => ({ x: h.apurado, y: h.parcial })) },
        { nome: "Projeção", cor: "var(--lula)", banda: true, pts: en.pontos.map((h) => ({ x: h.apurado, y: h.p50, lo: h.p10, hi: h.p90 })) },
      ],
    });
  }
  $("br-mesmas").innerHTML = tabelaMesmas(b.mesmas_urnas, "2º turno 2026 (agora)");
  const l = b.por_uf || [];
  $("br-ufs").innerHTML = `<tr><th>Estado</th><th>Apurado</th><th>Lula agora</th><th>1º turno</th><th>Δ</th><th>2022 2º turno</th><th>Δ</th><th>Abstenção</th><th>1º turno</th><th>2022</th></tr>` +
    l.map((u) => `<tr><td>${u.uf} <span class="muted">${esc(u.nome)}</span></td><td>${fmtP(u.apurado_pct, 1)}</td>
      <td>${fmtP(u.lula_pct, 1)}${u.lula_pct != null ? `<span class="mini"><i style="width:${u.lula_pct}%"></i></span>` : ""}</td>
      <td>${fmtP(u.lula_1t_pct, 1)}</td><td class="${sinal(u.lula_pct - u.lula_1t_pct)}">${u.lula_pct == null ? "—" : fmtPP(u.lula_pct - u.lula_1t_pct, 1)}</td>
      <td>${fmtP(u.lula_2022_pct, 1)}</td><td class="${sinal(u.lula_pct - u.lula_2022_pct)}">${u.lula_pct == null ? "—" : fmtPP(u.lula_pct - u.lula_2022_pct, 1)}</td>
      <td>${fmtP(u.abstencao_pct, 1)}</td><td>${fmtP(u.abstencao_1t_pct, 1)}</td><td>${fmtP(u.abstencao_2022_pct, 1)}</td></tr>`).join("");
}

// ---------------------------------------------------------------- Exterior
function renderExterior(est) {
  const x = est.exterior || {}, P = x.modelos || {}, p = P[modelo], outro = P[outroModelo()];
  const mu = x.mesmas_urnas || {}, mk = est.mercados || {};
  $("ex-placar").innerHTML =
    blocoContado("Somando os boletins de urna já publicados pelo TSE", `Contado agora · ${fmtN(x.secoes)} de ${fmtN(x.secoes_tot)} seções · último às ${hora(x.ultimo_bu)}`,
      mu.lula, mu.validos,
      `<span>Comparecimento <b>${fmtN(mu.comparecimento)}</b></span><span>Abstenção <b>${fmtP(mu.abstencao_pct, 1)}</b></span><span>1º turno nas mesmas urnas <b>${fmtP(mu["2026_1t"]?.abstencao_pct, 1)}</b></span>`) +
    blocoProjecao(p, "ex", outro, linhaMercados(mk.polymarket?.exterior_lula, mk.kalshi?.exterior_lula, "chance de Lula vencer no exterior"));
  $("ex-explica-sub").textContent = p && p.lula_pct != null ? `base ${nomeModelo()}` : "";
  $("ex-ledger").innerHTML = ledger(p, "do exterior");
  $("ex-passos").innerHTML = passos(p, "ex");
  $("ex-grupos").innerHTML = tabelaGrupos("ex-g", p?.por_pais, "País");
  const h = x.hist || [];
  grafico($("ex-conv"), {
    aria: "Projeção do exterior ao longo do dia", xFmt: fmtHora, refs: [{ y: 50, label: "50%" }],
    series: [
      { nome: "Contado", cor: "var(--parcial)", pts: h.map((r) => ({ x: tms(r.t), y: r.parcial, extra: `${r.secoes} seções` })) },
      { nome: "Projeção", cor: "var(--lula)", banda: true, pts: h.map((r) => ({ x: tms(r.t), y: r.p50, lo: r.p10, hi: r.p90 })) },
    ],
  });
  $("ex-mesmas").innerHTML = tabelaMesmas(mu, "2º turno 2026 (exterior)");
  const ps = (x.paises || []).slice().sort((a, b) => (b.secoes > 0) - (a.secoes > 0) || b.eleitorado - a.eleitorado);
  const com = ps.filter((r) => r.secoes > 0).length;
  $("ex-paises-sub").textContent = `${com} de ${ps.length} países com boletim`;
  const lista = expandido["ex-p"] ? ps : ps.slice(0, Math.max(com, 15));
  $("ex-paises").innerHTML = `<tr><th>País</th><th>Seções</th><th>Eleitores</th><th>Lula</th><th>Flávio</th><th>Lula %</th><th title="Lula × Flávio no 1º turno, nas mesmas urnas">1º turno</th><th>Δ</th><th title="Lula × Bolsonaro em 2022, nas mesmas urnas">2022</th><th>Abstenção</th><th>Abst. 1º turno</th></tr>` +
    lista.map((r) => `<tr><td>${esc(r.pais)}</td><td>${r.secoes}/${r.secoes_tot}</td><td>${fmtN(r.eleitorado)}</td>
      <td>${r.secoes ? fmtN(r.lula) : "—"}</td><td>${r.secoes ? fmtN(r.flavio) : "—"}</td>
      <td>${r.secoes ? fmtP(r.lula_pct, 1) + `<span class="mini"><i style="width:${r.lula_pct}%"></i></span>` : `<span class="muted">no 1º turno: ${fmtP(r.lula_1t_final_2v_pct, 1)}</span>`}</td>
      <td>${fmtP(r.lula_1t_2v_pct, 1)}</td><td class="${sinal(r.lula_pct - r.lula_1t_2v_pct)}">${r.secoes ? fmtPP(r.lula_pct - r.lula_1t_2v_pct, 1) : "—"}</td>
      <td>${fmtP(r.lula_2022_pct, 1)}</td><td>${fmtP(r.abstencao_pct, 1)}</td><td>${fmtP(r.abstencao_1t_pct, 1)}</td></tr>`).join("") +
    (ps.length > lista.length || expandido["ex-p"] ? `<tr><td colspan="11"><button class="mais" data-exp="ex-p">${expandido["ex-p"] ? "Mostrar menos" : `Mostrar todos (${ps.length})`}</button></td></tr>` : "");
}

// ---------------------------------------------------------------- Mercados
// rótulo do balde de margem → intervalo assinado (Lula positivo), em pontos percentuais
function intervaloMargem(rot) {
  const lado = /lula/i.test(rot) ? 1 : -1;
  const nums = (rot.match(/\d+(?:[.,]\d+)?/g) || []).map((v) => +v.replace(",", "."));
  let a, b;
  if (/≥/.test(rot)) { a = nums[0]; b = 100; } else if (/</.test(rot)) { a = 0; b = nums[0]; } else { a = nums[0]; b = nums[1] ?? nums[0]; }
  return lado > 0 ? [a, b] : [-b, -a];
}
function baldesMargem(lista, margem) {
  if (!lista || !lista.length) return `<div class="vazio">Sem dados.</div>`;
  const it = lista.map((m) => ({ ...m, iv: intervaloMargem(m.rotulo) })).sort((a, b) => a.iv[0] - b.iv[0]);
  const max = Math.max(...it.map((m) => m.prob || 0)) || 1;
  return `<div class="baldes">${it.map((m) => {
    const nosso = margem != null && margem >= m.iv[0] && margem < m.iv[1];
    return `<div class="balde ${nosso ? "nosso" : ""}"><span class="rot">${esc(m.rotulo)}</span>
      <div class="b" style="width:${(100 * (m.prob || 0)) / max}%;background:${m.iv[0] >= 0 ? "var(--lula)" : "var(--flavio)"}"></div>
      <span class="p">${fmtP(100 * (m.prob || 0), 0)}</span></div>`;
  }).join("")}</div>`;
}

function renderMercados(est) {
  const mk = est.mercados || {}, pm = mk.polymarket || {}, k = mk.kalshi || {};
  const P = est.brasil?.modelos || {};
  $("mk-sub").textContent = `Polymarket ${hora(pm.ts)} · Kalshi ${hora(k.ts)}`;
  const linha = (fonte, sub, prob, espera) => `<div class="prob-linha"><div class="fonte">${fonte}<small>${sub}</small></div>
    ${prob == null ? `<div class="muted">${espera || "sem dados"}</div>` : `<div class="trilho"><div class="bl" style="width:${prob}%"></div><div class="bf"></div></div>`}
    <div class="v">${prob == null ? "—" : fmtP(prob, 0)}</div></div>`;
  const pr = (id) => { const p = P[id]; return p && p.disponivel && p.lula_pct != null ? p.prob_lula : null; };
  const espera = `aguarda ${fmtP(est.min_apurado, 0)} do eleitorado apurado (depois das 17h)`;
  $("mk-prob").innerHTML =
    linha("Nosso modelo", "base 1º turno 2026", pr("vs_2026_1t"), espera) + linha("Nosso modelo", "base 2º turno 2022", pr("vs_2022_2t"), espera) +
    linha("Polymarket", "Brazil Presidential Election", pm.p_lula == null ? null : 100 * pm.p_lula) +
    linha("Kalshi", "KXBRPRES", k.p_lula == null ? null : 100 * k.p_lula);

  const p = P[modelo];
  const ok = p && p.disponivel && p.lula_pct != null;
  $("mk-fatia").innerHTML = `<div class="kpis">
      ${kpi("Kalshi · mediana implícita", fmtP(k.fatia_lula_mediana), "onde a chance de Lula ≥ x cruza 50%")}
      ${kpi(`Nosso modelo · base ${nomeModelo()}`, ok ? fmtP(p.lula_pct) : "—", ok ? `faixa ${fmtP(p.p10, 1)} a ${fmtP(p.p90, 1)}` : "aguarda a apuração")}
    </div><div class="sub-h">Kalshi: chance de Lula ter pelo menos x% dos válidos</div><div id="mk-escada" class="grafico" style="height:220px"></div>`;
  grafico($("mk-escada"), {
    aria: "Escada da Kalshi", xFmt: (v) => fmtP(v, 1), yMin: 0, yMax: 100, refs: [{ y: 50 }],
    vrefs: ok ? [{ x: p.lula_pct, label: "nosso modelo", solida: true, cor: "var(--text)" }] : [],
    series: [{ nome: "Kalshi", cor: "var(--kalshi)", pts: (k.escada_lula || []).map((e) => ({ x: e.limiar, y: 100 * e.prob })) }],
  });

  const margem = ok ? 2 * p.lula_pct - 100 : null;
  $("mk-margem").innerHTML = `<div class="muted">Diferença entre Lula e Flávio, em pontos dos válidos.${margem != null ? ` Nosso modelo: <b>${fmtPP(Math.abs(margem), 1)}</b> para ${margem >= 0 ? "Lula" : "Flávio"}.` : ""}</div>
    <div class="sub-h">Kalshi</div>${baldesMargem(k.margem, margem)}<div class="sub-h">Polymarket</div>${baldesMargem(pm.margem, margem)}`;

  const compNosso = ok ? 100 - p.abstencao_final_pct : null;
  const comp = (pm.comparecimento || []).map((c) => {
    const nums = (c.rotulo.match(/\d+/g) || []).map(Number);
    const iv = c.rotulo.includes("<") ? [0, nums[0]] : c.rotulo.includes("mais") ? [nums[0], 101] : [nums[0], nums[1]];
    const nosso = compNosso != null && compNosso >= iv[0] && compNosso < iv[1];
    return `<div class="balde ${nosso ? "nosso" : ""}"><span class="rot">${esc(c.rotulo)}</span><div class="b" style="width:${100 * (c.prob || 0)}%;background:var(--poly)"></div><span class="p">${fmtP(100 * (c.prob || 0), 0)}</span></div>`;
  }).join("");
  $("mk-comp").innerHTML = `<div class="kpis">
      ${kpi("Nosso modelo", compNosso != null ? fmtP(compNosso, 1) : "—", ok ? fmtN(p.comparecimento_final) + " votantes" : "aguarda a apuração")}
      ${kpi("Kalshi · mediana", k.comparecimento_mediana ? fmtN(k.comparecimento_mediana) : "—", "votantes")}
      ${kpi("1º turno 2026", "78,92%", "125.275.835 votantes")}
    </div><div class="sub-h">Polymarket: comparecimento</div><div class="baldes">${comp || '<div class="vazio">Sem dados.</div>'}</div>`;

  const pe = est.exterior?.modelos?.[modelo];
  const peOk = pe && pe.lula_pct != null && pe.disponivel;
  $("mk-ext").innerHTML =
    linha("Nosso modelo", `exterior, base ${nomeModelo()}`, peOk ? pe.prob_lula : null, "aguarda boletins") +
    linha("Polymarket", "1st Place Abroad", pm.exterior_lula == null ? null : 100 * pm.exterior_lula) +
    linha("Kalshi", "KXBRRUNOFFABROAD", k.exterior_lula == null ? null : 100 * k.exterior_lula) +
    (peOk ? `<p class="muted" style="margin-top:8px">Nossa projeção para o exterior: Lula ${fmtP(pe.lula_pct, 1)} (faixa ${fmtP(pe.p10, 1)} a ${fmtP(pe.p90, 1)}).</p>` : "");

  const H = mk.hist || {};
  const nossoH = (est.brasil?.hist || []).filter((h) => h.modelo === modelo);
  grafico($("mk-hist"), {
    aria: "Chance de Lula ao longo do dia", xFmt: fmtHora, yMin: 0, yMax: 100, refs: [{ y: 50 }],
    series: [
      { nome: "Polymarket", cor: "var(--poly)", pts: (H.polymarket || []).filter((r) => r.p_lula != null).map((r) => ({ x: tms(r.t), y: 100 * r.p_lula })) },
      { nome: "Kalshi", cor: "var(--kalshi)", pts: (H.kalshi || []).filter((r) => r.p_lula != null).map((r) => ({ x: tms(r.t), y: 100 * r.p_lula })) },
      { nome: "Nosso modelo", cor: "var(--text)", pts: nossoH.map((r) => ({ x: tms(r.ts), y: r.prob })) },
    ],
  });
}

// ---------------------------------------------------------------- Coleta
function renderColeta(est) {
  const s = est.saude || {};
  const idade = (ts) => (ts ? Math.round((Date.now() - new Date(ts).getTime()) / 1000) : null);
  const nomes = { vigia: "Vigia", oficial: "Totalização oficial", exterior: "Exterior (BUs)", mercados: "Mercados", cruzamento_ascaribe: "Cruzamento com ascaribe" };
  const c = est.coleta || {};
  $("cl-sub").textContent = `BUs ${c.bu_secoes}/${c.secoes_ext} · municípios lidos ${c.municipios_lidos} · bases ${Object.entries(est.bases_ok || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`;
  $("cl-saude").innerHTML = `<div class="tabela-wrap"><table><tr><th>Laço</th><th>Última batida</th><th>Há</th><th style="text-align:left">Detalhe</th></tr>` +
    Object.entries(nomes).filter(([k]) => s[k]).map(([k, n]) => {
      let v = s[k].valor; try { v = JSON.stringify(JSON.parse(v)); } catch {}
      const i = idade(s[k].ts);
      return `<tr><td>${n}</td><td>${hora(s[k].ts)}</td><td>${i == null ? "—" : i + " s"}</td><td style="text-align:left;white-space:normal" class="muted">${esc(v).slice(0, 240)}</td></tr>`;
    }).join("") + `</table></div>`;
  $("cl-eventos").innerHTML = (est.eventos || []).map((e) => `<li class="${e.nivel}">${e.ts.slice(11, 19)} ${esc(e.nivel)} ${esc(e.msg)}</li>`).join("");
}

function render(est) {
  EST = est;
  for (const id of ["seg-brasil", "seg-exterior"]) $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === modelo));
  const n = est.nacional;
  const st = $("status");
  st.textContent = est.fase === "apurando" ? `Apurando · ${fmtP(n.apurado_pct)}` : `Antes das 17h · exterior ${est.exterior?.secoes ?? 0}/${est.exterior?.secoes_tot ?? 0}`;
  st.className = "pill" + (est.fase === "apurando" ? " ok" : "");
  let vg = {}; try { vg = JSON.parse(est.saude?.vigia?.valor || "{}"); } catch {}
  const vEl = $("vigia");
  vEl.textContent = vg.status === "ok" ? "vigia ok" : vg.status === "alerta" ? "vigia: alerta" : "vigia —";
  vEl.className = "pill" + (vg.status === "ok" ? " ok" : vg.status === "alerta" ? " alerta" : "");
  vEl.title = (vg.problemas || []).join("\n") || "Sem problemas";
  $("atualizado").textContent = "atualizado " + est.agora.slice(11, 19);
  if (aba === "brasil") renderBrasil(est);
  if (aba === "exterior") renderExterior(est);
  if (aba === "mercados") renderMercados(est);
  if (aba === "coleta") renderColeta(est);
}

async function ciclo() {
  try {
    const r = await fetch("/api/estado", { cache: "no-store" });
    if (r.ok) render(await r.json());
  } catch (e) {
    $("atualizado").textContent = "falha ao ler o servidor local";
  }
}
initUI();
ciclo();
setInterval(ciclo, POLL_MS);
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => EST && render(EST), 200); });
