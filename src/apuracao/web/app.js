"use strict";

const POLL_MS = 10000;
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("pt-BR");
const fmtN = (x) => (x == null || Number.isNaN(x) ? "—" : nf.format(Math.round(x)));
const fmtP = (x, d = 1) => (x == null || Number.isNaN(x) ? "—" : x.toFixed(d).replace(".", ",") + "%");
const fmtPP = (x, d = 1) => (x == null || Number.isNaN(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d).replace(".", ",") + " pp");
const fmtS = (x) => (x == null ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + nf.format(Math.abs(Math.round(x))));
const fmtMi = (x) => (x == null ? "—" : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2).replace(".", ",") + " mi" : Math.abs(x) >= 1e4 ? nf.format(Math.round(x / 1e3)) + " mil" : nf.format(Math.round(x)));
const sinal = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
const hora = (iso) => (iso ? iso.slice(11, 16) : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const tms = (iso) => new Date(iso).getTime();
const fmtHora = (ms) => new Date(ms).toTimeString().slice(0, 5);

const MODELO = "vs_2026_1t", MODELO_ALT = "vs_2022_2t";
const NOME_MODELO = { vs_2026_1t: "1º turno 2026", vs_2022_2t: "2º turno 2022" };
const REGIAO = { ac: "Norte", am: "Norte", ap: "Norte", pa: "Norte", ro: "Norte", rr: "Norte", to: "Norte",
  al: "Nordeste", ba: "Nordeste", ce: "Nordeste", ma: "Nordeste", pb: "Nordeste", pe: "Nordeste", pi: "Nordeste", rn: "Nordeste", se: "Nordeste",
  df: "Centro-Oeste", go: "Centro-Oeste", ms: "Centro-Oeste", mt: "Centro-Oeste",
  es: "Sudeste", mg: "Sudeste", rj: "Sudeste", sp: "Sudeste", pr: "Sul", rs: "Sul", sc: "Sul", zz: "Exterior" };

let aba = "brasil";
let EST = null;
const sel = { brasil: null, exterior: null };
const modo = { brasil: ls.get("modo-br", "proj"), exterior: ls.get("modo-ex", "proj") };
const expandido = {};
const GEO = { br: null, mundo: null };
const SVG = { br: null, mundo: null };

// ================================================================ cores do mapa
const COR = (n) => `var(--${n})`;
function corFatia(v) {
  if (v == null) return COR("vazio");
  if (v >= 50) return COR(v < 55 ? "l1" : v < 60 ? "l2" : v < 70 ? "l3" : "l4");
  return COR(v > 45 ? "f1" : v > 40 ? "f2" : v > 30 ? "f3" : "f4");
}
function corDesvio(v) {
  if (v == null) return COR("vazio");
  const a = Math.abs(v), k = a < 1 ? 1 : a < 3 ? 2 : a < 6 ? 3 : 4;
  return COR((v >= 0 ? "l" : "f") + k);
}
function corAndamento(v) {
  if (!v) return COR("vazio");
  return COR(v < 25 ? "a1" : v < 50 ? "a2" : v < 99.95 ? "a3" : "a4");
}
const MODOS = {
  proj: { rot: "Projeção", cor: corFatia },
  contado: { rot: "Contado", cor: corFatia },
  desvio: { rot: "Desvio", cor: corDesvio },
  andamento: { rot: "Andamento", cor: corAndamento },
  t1: { rot: "1º turno", cor: corFatia },
};
function legenda(m) {
  const esc4 = (pref, rots) => rots.map((r, i) => `<span><i style="background:${COR(pref + (i + 1))}"></i>${r}</span>`);
  if (m === "andamento") {
    return `<span class="escala"><span><i style="background:${COR("vazio")}"></i>0</span>${esc4("a", ["<25%", "<50%", "<100%", "100%"]).join("")}</span><span>das urnas apuradas</span>`;
  }
  if (m === "desvio") {
    return `<span class="lado" style="color:var(--flavio)">Flávio melhor</span><span class="escala">${esc4("f", ["6+", "3–6", "1–3", "0–1"]).reverse().join("")}${esc4("l", ["0–1", "1–3", "3–6", "6+"]).join("")}</span><span class="lado" style="color:var(--lula)">Lula melhor</span><span>que a base, em pp</span>`;
  }
  return `<span class="lado" style="color:var(--flavio)">Flávio</span><span class="escala">${esc4("f", ["50", "55", "60", "70+"]).reverse().join("")}${esc4("l", ["50", "55", "60", "70+"]).join("")}</span><span class="lado" style="color:var(--lula)">Lula</span><span>% dos válidos</span>`;
}

// ================================================================ zoom do mapa
function zoomPara(svg, box, ms = 480) {
  const de = svg.viewBox.baseVal, a = [de.x, de.y, de.width, de.height];
  const r = svg.dataset.razao ? +svg.dataset.razao : de.height / de.width;
  let [x, y, w, h] = box;
  const pad = Math.max(w, h) * 0.08; x -= pad; y -= pad; w += 2 * pad; h += 2 * pad;
  if (h / w > r) { const nw = h / r; x -= (nw - w) / 2; w = nw; } else { const nh = w * r; y -= (nh - h) / 2; h = nh; }
  const b = [x, y, w, h], t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    const v = a.map((ai, i) => ai + (b[i] - ai) * e);
    svg.setAttribute("viewBox", v.join(" "));
    if (svg.dataset.mundo) ajustarBolhas(svg, v[2]);
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
function ajustarBolhas(svg, largura) {
  const k = Math.pow(largura / 1000, 0.8);
  svg.querySelectorAll(".bolha").forEach((c) => c.setAttribute("r", (+c.dataset.r * k).toFixed(2)));
}

// ================================================================ Brasil: geometria e dados
async function garantirGeo(qual) {
  if (GEO[qual]) return GEO[qual];
  const r = await fetch(qual === "br" ? "geo_br.json" : "geo_mundo.json");
  GEO[qual] = await r.json();
  return GEO[qual];
}

function montarBR(g) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
  svg.dataset.razao = g.h / g.w;
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Mapa do Brasil por município");
  svg.innerHTML = `<g class="muns">${Object.entries(g.mun).map(([k, d]) => `<path class="m" data-k="${k}" d="${d}"/>`).join("")}</g>
    <g>${Object.entries(g.uf).map(([uf, d]) => `<path class="ufs" data-uf="${uf}" d="${d}"/>`).join("")}</g>
    <path class="uf-sel" d=""/>`;
  const tip = $("tooltip");
  let ultimo = null;
  svg.addEventListener("mousemove", (ev) => {
    const p = ev.target.closest(".m");
    if (!p) { tip.hidden = true; return; }
    if (ultimo !== p) { ultimo?.classList.remove("on"); p.classList.add("on"); p.parentNode.appendChild(p); ultimo = p; }
    const r = MUN[p.dataset.k];
    if (!r) { tip.hidden = true; return; }
    tooltip(ev, `<div class="tt-n">${esc(r[1])}</div><div class="tt-s">${r[2].toUpperCase()} · ${fmtN(r[3])} eleitores</div>
      <div class="tt-g"><span>Apurado</span><span>${fmtP(r[4], 0)}</span>
      <span>Lula no contado</span><span>${fmtP(r[5])}</span>
      ${brOk() ? `<span>Lula projetado</span><span>${fmtP(r[6])}</span><span>Desvio da base</span><span>${r[7] == null ? "—" : fmtPP(r[7])}</span>` : ""}
      <span>Lula no 1º turno*</span><span>${fmtP(r[8])}</span></div>
      <div class="tt-s" style="margin:6px 0 0">* entre Lula e Flávio</div>`);
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; ultimo?.classList.remove("on"); ultimo = null; });
  svg.addEventListener("click", (ev) => {
    const p = ev.target.closest(".m"); if (!p) return;
    const r = MUN[p.dataset.k]; if (r) selecionar(r[2]);
  });
  return svg;
}

let MUN = {};
function brOk() {
  const p = EST?.brasil?.modelos?.[MODELO];
  return !!(p && p.disponivel && p.lula_pct != null && EST.fase === "apurando");
}

function pintarBR() {
  const svg = SVG.br; if (!svg) return;
  const m = modo.brasil, cor = MODOS[m].cor;
  const col = { proj: 6, contado: 5, desvio: 7, andamento: 4, t1: 8 }[m];
  svg.querySelectorAll(".m").forEach((p) => {
    const r = MUN[p.dataset.k];
    const v = r ? r[col] : null;
    p.style.fill = m === "andamento" ? cor(v) : (m === "contado" || m === "desvio") && r && !r[4] ? COR("vazio") : cor(v);
  });
  const u = sel.brasil;
  const alvo = u ? svg.querySelector(`.ufs[data-uf="${u}"]`) : null;
  svg.querySelector(".uf-sel").setAttribute("d", alvo ? alvo.getAttribute("d") : "");
}

// ================================================================ Exterior: geometria e dados
const PRESETS = [
  { id: "mundo", rot: "Mundo", box: null },
  { id: "americas", rot: "Américas", lon: [-125, -34], lat: [-56, 50] },
  { id: "europa", rot: "Europa", lon: [-12, 30], lat: [36, 60] },
  { id: "asia", rot: "Ásia e Oceania", lon: [60, 178], lat: [-45, 50] },
];
function projMundo(lon, lat) {
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2, ESC = 1000 / (2 * 2.7064);
  const lam = (lon * Math.PI) / 180, th = Math.asin(M * Math.sin((lat * Math.PI) / 180)), t2 = th * th, t6 = t2 ** 3;
  const x = (lam * Math.cos(th)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [500 + x * ESC, 245 - y * ESC];
}
const MUNDO_Y0 = projMundo(0, 84)[1], MUNDO_Y1 = projMundo(0, -57)[1];
const MUNDO_BOX = [0, MUNDO_Y0, 1000, MUNDO_Y1 - MUNDO_Y0];
function boxPreset(p) {
  if (!p.lon) return MUNDO_BOX;
  const pts = [[p.lon[0], p.lat[0]], [p.lon[1], p.lat[0]], [p.lon[0], p.lat[1]], [p.lon[1], p.lat[1]], [(p.lon[0] + p.lon[1]) / 2, p.lat[1]]].map(([a, b]) => projMundo(a, b));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

function montarMundo(g) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", MUNDO_BOX.join(" "));
  svg.dataset.razao = MUNDO_BOX[3] / MUNDO_BOX[2];
  svg.dataset.mundo = "1";
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Mapa-múndi do voto no exterior");
  svg.innerHTML = `<g class="paises">${Object.entries(g.pais).map(([k, d]) => `<path class="pais" data-iso="${k}" d="${d}"/>`).join("")}</g><g class="bolhas"></g>`;
  const tip = $("tooltip");
  svg.addEventListener("mousemove", (ev) => {
    const el = ev.target.closest("[data-iso]");
    const r = el && PAIS[el.dataset.iso];
    if (!r) { tip.hidden = true; return; }
    tooltip(ev, `<div class="tt-n">${esc(r.pais)}</div><div class="tt-s">${fmtN(r.eleitorado)} eleitores · ${r.secoes}/${r.secoes_tot} seções</div>
      <div class="tt-g"><span>Lula no contado</span><span>${r.secoes ? fmtP(r.lula_pct) : "—"}</span>
      ${r.proj ? `<span>Lula projetado</span><span>${fmtP(r.proj.lula_final_pct)}</span>` : ""}
      <span>Lula no 1º turno*</span><span>${fmtP(r.lula_1t_final_2v_pct)}</span>
      <span>Lula em 2022</span><span>${fmtP(r.lula_2022_pct)}</span></div>
      <div class="tt-s" style="margin:6px 0 0">* entre Lula e Flávio</div>`);
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; });
  svg.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-iso]");
    if (el && PAIS[el.dataset.iso]) selecionar(el.dataset.iso);
  });
  return svg;
}

let PAIS = {};
function valorPais(r, m) {
  if (m === "proj") return r.proj ? r.proj.lula_final_pct : null;
  if (m === "contado") return r.secoes ? r.lula_pct : null;
  if (m === "desvio") return r.secoes && r.lula_1t_2v_pct != null ? r.lula_pct - r.lula_1t_2v_pct : null;
  if (m === "andamento") return r.secoes_tot ? (100 * r.secoes) / r.secoes_tot : 0;
  return r.lula_1t_final_2v_pct;
}
function pintarMundo() {
  const svg = SVG.mundo; if (!svg) return;
  const m = modo.exterior, cor = MODOS[m].cor, g = GEO.mundo;
  svg.querySelectorAll(".pais").forEach((p) => {
    p.style.fill = PAIS[p.dataset.iso] ? COR("vazio") : COR("pais-sem");
  });
  const lista = Object.values(PAIS).filter((r) => g.centro[r.iso3]).sort((a, b) => b.eleitorado - a.eleitorado);
  const maxE = lista.length ? lista[0].eleitorado : 1;
  svg.querySelector(".bolhas").innerHTML = lista.map((r) => {
    const [cx, cy] = g.centro[r.iso3], rr = 2 + 16 * Math.sqrt(r.eleitorado / maxE);
    return `<circle class="bolha${sel.exterior === r.iso3 ? " on" : ""}" data-iso="${r.iso3}" data-r="${rr.toFixed(2)}" cx="${cx}" cy="${cy}" r="${rr.toFixed(2)}" style="fill:${cor(valorPais(r, m))}"/>`;
  }).join("");
  ajustarBolhas(svg, svg.viewBox.baseVal.width);
}

// ================================================================ seleção e tooltip
function tooltip(ev, html) {
  const tip = $("tooltip");
  tip.hidden = false; tip.innerHTML = html;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(ev.clientX + 16, innerWidth - w - 8) + "px";
  tip.style.top = Math.min(ev.clientY + 16, innerHeight - h - 8) + "px";
}
function selecionar(chave) {
  const esc_ = aba === "exterior" ? "exterior" : "brasil";
  sel[esc_] = sel[esc_] === chave ? null : chave;
  if (esc_ === "brasil") {
    const svg = SVG.br;
    const alvo = sel.brasil && svg.querySelector(`.ufs[data-uf="${sel.brasil}"]`);
    if (alvo) { const b = alvo.getBBox(); zoomPara(svg, [b.x, b.y, b.width, b.height]); }
    else zoomPara(svg, [0, 0, GEO.br.w, GEO.br.h]);
  } else {
    const svg = SVG.mundo, c = sel.exterior && GEO.mundo.centro[sel.exterior];
    const alvo = sel.exterior && svg.querySelector(`.pais[data-iso="${sel.exterior}"]`);
    if (alvo) {
      const b = alvo.getBBox(), w = Math.max(b.width, 90), h = Math.max(b.height, 50);
      const cx = Math.min(Math.max(c[0], b.x), b.x + b.width), cy = Math.min(Math.max(c[1], b.y), b.y + b.height);
      zoomPara(svg, b.width > 300 ? [c[0] - 150, c[1] - 80, 300, 160] : [cx - w / 2, cy - h / 2, w, h]);
    } else zoomPara(svg, MUNDO_BOX);
  }
  if (EST) render(EST);
}

// ================================================================ lateral
function frase(p) {
  const q = p.prob_lula;
  if (q >= 99) return { t: "Lula vence", c: "l", s: "A projeção não vê mais caminho para Flávio." };
  if (q <= 1) return { t: "Flávio vence", c: "f", s: "A projeção não vê mais caminho para Lula." };
  if (q >= 90) return { t: "Lula muito provável", c: "l" };
  if (q <= 10) return { t: "Flávio muito provável", c: "f" };
  if (q >= 70) return { t: "Lula favorito", c: "l" };
  if (q <= 30) return { t: "Flávio favorito", c: "f" };
  return { t: "Disputa aberta", c: "" };
}
function barraProj(p) {
  return `<div class="barra-proj"><div class="bl" style="width:${p.lula_pct}%"></div><div class="bf"></div>
    <div class="faixa" style="left:${p.p10}%;width:${Math.max(0.6, p.p90 - p.p10)}%" title="Faixa de 80%"></div><div class="meio"></div></div>`;
}
function veredito(p, alt, escopo, est) {
  const br = escopo === "brasil";
  const ok = br ? brOk() : !!(p && p.lula_pct != null && p.disponivel);
  const rot = br ? "Projeção do resultado" : "Projeção do exterior";
  if (!ok) {
    const ap = p ? 100 * p.apurado_eleitorado : 0;
    const t = br && est.fase !== "apurando" ? "A apuração começa às 17h" : `Esperando ${br ? 5 : 2}% apurado`;
    const s = br && est.fase !== "apurando"
      ? `Até lá só o exterior tem votos, e eles não dizem nada sobre o Brasil. O mapa mostra o 1º turno como referência.`
      : `Agora: ${fmtP(ap)} do eleitorado. Com pouco voto contado, a projeção ainda seria chute.`;
    return `<div class="rot">${rot}</div><div class="frase">${t}<small>${s}</small></div>`;
  }
  const f = frase(p), lado = p.margem_votos >= 0 ? "Lula" : "Flávio";
  return `<div class="rot">${rot} · ${fmtP(100 * p.apurado_eleitorado, 0)} apurado</div>
    <div class="frase ${f.c}">${f.t}${f.s ? `<small>${f.s}</small>` : ""}</div>
    <div class="duelo"><div class="lado"><span class="nome">Lula · 13</span><span class="pct l">${fmtP(p.lula_pct)}</span></div>
      <div class="lado dir"><span class="nome">Flávio · 22</span><span class="pct f">${fmtP(100 - p.lula_pct)}</span></div></div>
    ${barraProj(p)}
    <div class="det"><span>faixa <b>${fmtP(p.p10)}–${fmtP(p.p90)}</b></span><span>chance de Lula <b>${fmtP(p.prob_lula, 0)}</b></span><span>${lado} por <b>${fmtMi(Math.abs(p.margem_votos))}</b></span></div>
    ${alt && alt.lula_pct != null ? `<div class="alt">Usando o ${NOME_MODELO[MODELO_ALT]} como base: <b>Lula ${fmtP(alt.lula_pct)}</b> (${fmtP(alt.p10)}–${fmtP(alt.p90)}).</div>` : ""}`;
}

function blocoContado(titulo, info, lula, validos, porque) {
  if (!validos) return `<h3>Contado agora<span>${info}</span></h3><p class="porque">${titulo}</p>`;
  const pl = (100 * lula) / validos;
  return `<h3>Contado agora<span>${info}</span></h3>
    <div class="contado-linha"><span class="v l">${fmtP(pl)}</span><span class="v f">${fmtP(100 - pl)}</span></div>
    <div class="mini-barra"><div class="bl" style="width:${pl}%"></div><div class="bf"></div></div>
    <p class="porque">${porque || ""}</p>`;
}

function blocoChances(nosso, pm, k, sub) {
  // disputa binária: barra dividida Lula | Flávio e, à direita, quem é o favorito e com quanto
  const linha = (q, v, cls = "") => {
    const f = favorito(v);
    return `<div class="chance ${cls}"><span class="q">${q}</span>
    ${v == null ? `<div class="t nada"></div>` : `<div class="t" title="Lula ${fmtP(par(v)[0], 0)} · Flávio ${fmtP(par(v)[1], 0)}"><div class="bl" style="width:${v}%"></div><div class="bf"></div></div>`}
    <span class="v">${f ? `${marca(f.c)}${f.nome} ${fmtP(par(f.v, 1)[0], 1)}` : "—"}</span></div>`;
  };
  return `<h3>Quem vence<span>${sub}</span></h3>
    <div class="chance chance-cab"><span></span><span class="lados"><span>${marca("l")}Lula</span><span>Flávio${marca("f")}</span></span><span class="v">favorito</span></div>
    ${linha("Nosso modelo", nosso, "nosso")}${linha("Polymarket", pm == null ? null : 100 * pm)}${linha("Kalshi", k == null ? null : 100 * k)}`;
}

// ================================================================ cascata: do contado à projeção
function passosCascata(p, grupos, rotulo) {
  if (!p || !p.contado || !grupos) return null;
  const L0 = p.contado.lula, V0 = p.contado.validos;
  const it = grupos.map((g) => ({ nome: rotulo(g), resto: g.resto, L: (g.validos_esperados * (g.lula_esperado_pct ?? 0)) / 100, V: g.validos_esperados }))
    .filter((g) => g.V > 0)
    .map((g) => ({ ...g, ef: (L0 + g.L) / (V0 + g.V) - L0 / Math.max(V0, 1) }))
    .sort((a, b) => !!a.resto - !!b.resto || Math.abs(b.ef) - Math.abs(a.ef));
  let L = L0, V = V0;
  const s0 = V0 ? (100 * L0) / V0 : null;
  const passos = it.map((g) => { const de = (100 * L) / V; L += g.L; V += g.V; return { ...g, de, ate: (100 * L) / V }; });
  return { s0, passos, fim: (100 * L) / V, falta: passos.reduce((a, g) => a + g.V, 0) };
}
function agruparRegioes(porUf) {
  const m = {};
  for (const g of porUf || []) {
    const r = REGIAO[g.grupo] || "?";
    const e = (m[r] ||= { grupo: r, validos_esperados: 0, _l: 0 });
    e.validos_esperados += g.validos_esperados; e._l += (g.validos_esperados * (g.lula_esperado_pct ?? 0)) / 100;
  }
  return Object.values(m).map((e) => ({ ...e, lula_esperado_pct: e.validos_esperados ? (100 * e._l) / e.validos_esperados : 0 }));
}
function agruparPaises(porPais, n = 8) {
  const g = (porPais || []).slice().sort((a, b) => Math.abs(b.saldo_esperado) - Math.abs(a.saldo_esperado));
  const top = g.slice(0, n), resto = g.slice(n);
  if (resto.length) {
    const V = resto.reduce((a, x) => a + x.validos_esperados, 0), L = resto.reduce((a, x) => a + (x.validos_esperados * (x.lula_esperado_pct ?? 0)) / 100, 0);
    top.push({ grupo: `Outros ${resto.length} países`, resto: true, validos_esperados: V, lula_esperado_pct: V ? (100 * L) / V : 0 });
  }
  return top;
}
function cascata(c) {
  if (!c || c.s0 == null) return `<div class="vazio">Aparece junto com a projeção.</div>`;
  const vals = [c.s0, c.fim, 50, ...c.passos.flatMap((g) => [g.de, g.ate])];
  let lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const X = (v) => (100 * (v - lo)) / (hi - lo);
  const cinq = `<i class="cinq" style="left:${X(50)}%"></i>`;
  const barraCheia = (v) => `<div class="pista">${cinq}<div class="b" style="left:0;width:${X(v)}%;background:${v >= 50 ? "var(--lula)" : "var(--flavio)"}"></div></div>`;
  let h = `<div class="cascata"><span class="r forte">Contado agora</span>${barraCheia(c.s0)}<span class="v forte">${fmtP(c.s0)}</span>`;
  for (const g of c.passos) {
    const a = Math.min(g.de, g.ate), b = Math.max(g.de, g.ate), d = g.ate - g.de;
    h += `<span class="r" title="${esc(g.nome)}: ${fmtMi(g.V)} votos válidos a contar">+ falta ${esc(g.nome)}</span>
      <div class="pista">${cinq}<div class="b" style="left:${X(a)}%;width:max(2px,${X(b) - X(a)}%);background:${d >= 0 ? "var(--lula)" : "var(--flavio)"}"></div></div>
      <span class="v ${sinal(d)}">${fmtPP(d, 2)}</span>`;
  }
  h += `<span class="r forte">Projeção</span>${barraCheia(c.fim)}<span class="v forte">${fmtP(c.fim)}</span>`;
  const ticks = [lo, 50, hi].filter((t, i, a) => a.indexOf(t) === i);
  h += `<span></span><div class="eixo">${ticks.map((t) => `<span style="left:${X(t)}%">${t}%</span>`).join("")}</div><span></span></div>`;
  return h;
}
function frasePorque(c) {
  if (!c || c.s0 == null || !c.passos.length) return "";
  const d = c.fim - c.s0;
  if (Math.abs(d) < 0.3) return "O contado já está perto da projeção: o que falta vota parecido com o que já chegou.";
  const dom = c.passos.filter((g) => !g.resto && Math.sign(g.ate - g.de) === Math.sign(d)).sort((a, b) => Math.abs(b.ate - b.de) - Math.abs(a.ate - a.de))[0];
  return `Ainda faltam <b>${fmtMi(c.falta)}</b> de votos válidos, e eles devem ${d < 0 ? "baixar" : "subir"} Lula para <b>${fmtP(c.fim)}</b>.${dom ? ` O que mais pesa: <b>${esc(dom.nome)}</b>.` : ""}`;
}

// ================================================================ gráfico de linhas com faixa
function grafico(el, cfg) {
  const series = cfg.series.filter((s) => s.pts && s.pts.length);
  const comDados = series.filter((s) => s.pts.length >= 2);
  if (!comDados.length) { el.style.height = "auto"; el.innerHTML = `<div class="vazio">${cfg.vazio || "Aguardando dados."}</div>`; return; }
  el.style.height = "";
  const W = el.clientWidth || 700, H = (el.clientHeight || 280) - 26, m = { l: 40, r: 12, t: 12, b: 22 };
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
    svg += `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2" stroke-linejoin="round" ${s.tracejada ? 'stroke-dasharray="5 4"' : ""}/>`;
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
  svg += `<text x="${m.l}" y="${H - 4}" font-size="11" fill="var(--muted)">${esc(xFmt(x0))}</text><text x="${W - m.r}" y="${H - 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(xFmt(x1))}</text>`;
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
    tooltip(ev, `<div class="tt-s">${esc(xFmt(xv))}${base[bi].extra ? " · " + esc(base[bi].extra) : ""}</div>${linhas}`);
  });
  sv.addEventListener("mouseleave", () => { tip.hidden = true; cruz.setAttribute("visibility", "hidden"); });
}

// ================================================================ feed do exterior: o que acabou de entrar (agente A)
// novos: o que não estava na tela no ciclo anterior (ou, ao abrir a página, o que chegou depois da última visita)
const FEED = { vistos: null, novoAte: {} };
const NOVO_MS = 5 * 60 * 1000;
const chaveBU = (r) => `${r.mun}/${r.zona}/${r.secao}`;
function feedNovos(rec) {
  const agora = Date.now();
  if (FEED.vistos == null) {
    const ate = ls.get("ext-visto-ate", "");
    FEED.vistos = new Set(rec.filter((r) => !ate || r.t <= ate).map(chaveBU));
  }
  for (const r of rec) if (!FEED.vistos.has(chaveBU(r))) { FEED.vistos.add(chaveBU(r)); FEED.novoAte[chaveBU(r)] = agora + NOVO_MS; }
  if (rec.length) ls.set("ext-visto-ate", rec[0].t);
  return (r) => (FEED.novoAte[chaveBU(r)] || 0) > agora;
}
// diferença de Lula (pp, a favor de Lula se > 0) → chip com o nome de quem ganhou terreno
function chipComp(rot, d, titulo) {
  const corpo = d == null ? `<span class="muted">sem base</span>`
    : Math.abs(d) < 0.05 ? `<span>igual</span>`
    : `${marca(d > 0 ? "l" : "f")}<span>${d > 0 ? "Lula" : "Flávio"} +${Math.abs(d).toFixed(1).replace(".", ",")}</span>`;
  return `<span class="fx-chip" title="${esc(titulo)}"><small>${rot}</small><span class="v">${corpo}</span></span>`;
}
const fmtPPs = (d) => (d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(1).replace(".", ","));
const listaPaises = (ps, n = 3) => {
  const nomes = ps.slice(0, n).map((p) => p[0]);
  const txt = nomes.length > 1 ? nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1] : nomes[0] || "";
  return txt + (ps.length > n ? ` +${ps.length - n}` : "");
};
function renderFeedExterior(est) {
  const x = est.exterior || {}, rec = x.recentes || [], lotes = x.lotes || [];
  $("feed-titulo").textContent = "O que acabou de entrar";
  $("feed-sub").textContent = "boletins na ordem em que o TSE recebeu · horário de Brasília";
  if (!rec.length) { $("feed").innerHTML = `<div class="vazio">Nenhum boletim do exterior ainda.</div>`; return; }
  const novo = feedNovos(rec);
  const nNovos = rec.filter(novo).length;
  // ---------- resumo do último lote ----------
  const L = lotes[0];
  const minAtras = L ? Math.round((tms(est.agora) - tms(L.ate)) / 60000) : null;
  const quando = L ? (minAtras <= 0 ? "Últimos 10 min" : `${hora(L.de)}–${hora(L.ate)} (há ${minAtras} min)`) : "";
  const ref1 = L && L.secao_1t === L.boletins ? "nessas seções" : L && L.secao_1t ? "nessas seções e cidades" : "nessas cidades";
  const resumo = L ? `<div class="fx-resumo"><b>${quando}:</b> ${L.boletins} ${L.boletins === 1 ? "boletim" : "boletins"} de ${esc(listaPaises(L.paises))}
    <span class="sep">·</span> <b>Lula × Flávio: Lula ${fmtP(L.lula_pct)}</b> <span class="muted">(no 1º turno ${ref1}: ${fmtP(L.lula_1t_pct)})</span>
    <span class="sep">·</span> abstenção <b>${fmtP(L.abstencao_pct, 0)}</b> <span class="muted">(1º turno: ${fmtP(L.abstencao_1t_pct, 0)})</span>
    ${nNovos ? `<span class="fx-novos">${nNovos} ${nNovos === 1 ? "novo" : "novos"} desde a última atualização</span>` : ""}</div>` : "";
  renderPlacarExterior(x.placar);
  // ---------- boletins: os 10 mais recentes, o resto ao expandir (sem rolagem interna) ----------
  const N_BU = 10, N_LOTES = 6;
  const recVis = expandido["fx-bu"] ? rec : rec.slice(0, N_BU);
  const linhas = recVis.map((r) => {
    const pl = r.lula_pct;
    // padrão: mesma seção, sem rótulo; o rótulo só aparece na exceção (média da cidade)
    const cid1 = r.ref_1t === "cidade", cid22 = r.ref_2022 === "cidade";
    return `<div class="fx-bu ${novo(r) ? "novo" : ""}">
      <span class="fx-h">${hora(r.t)}${novo(r) ? `<em>novo</em>` : ""}</span>
      <span class="fx-onde"><b>${esc(r.cidade)}</b><small>${esc(r.pais)} · zona ${+r.zona} · seção ${+r.secao}</small></span>
      <span class="fx-duelo">${pl == null ? `<span class="muted">sem votos válidos</span>` : `<span class="nums"><span>${marca("l")}Lula <b>${fmtP(par(pl)[0], 0)}</b></span><span>Flávio <b>${fmtP(par(pl)[1], 0)}</b>${marca("f")}</span></span>
        <span class="t"><i class="bl" style="width:${pl}%"></i><i class="bf"></i></span>
        <small>${fmtN(r.lula)} × ${fmtN(r.flavio)} · ${fmtN(r.brancos)} br. · ${fmtN(r.nulos)} nulos</small>`}</span>
      <span class="fx-abst"><small>abstenção</small><b>${fmtP(r.abstencao_pct, 0)}</b><small>1º t. ${fmtP(r.abstencao_1t_pct, 0)}${cid1 ? "*" : ""}</small></span>
      <span class="fx-chips">
        ${chipComp(`1º turno${cid1 ? " · média da cidade" : ""}`, r.d_lula_1t, `Lula entre Lula e Flávio: ${fmtP(pl)} agora × ${fmtP(r.lula_1t_pct)} no 1º turno (${cid1 ? "média da cidade: seção sem boletim no 1º turno" : "mesma seção"}). Abstenção: ${fmtP(r.abstencao_pct)} × ${fmtP(r.abstencao_1t_pct)}.`)}
        ${chipComp(`2022${cid22 ? " · média da cidade" : ""}`, r.d_lula_2022, `Lula × Bolsonaro no 2º turno de 2022 (${cid22 ? "média da cidade: seção não existia em 2022" : "mesma seção"}): ${fmtP(r.lula_2022_pct)}. Abstenção em 2022: ${fmtP(r.abstencao_2022_pct)}.`)}
      </span></div>`;
  }).join("");
  const maisBU = rec.length > N_BU ? `<button class="mais" data-exp="fx-bu">${expandido["fx-bu"] ? "Ver só os 10 mais recentes" : `Ver mais (${rec.length} mais recentes)`}</button>` : "";
  // ---------- lotes ----------
  const lotesVis = expandido["fx-lotes"] ? lotes : lotes.slice(0, N_LOTES);
  const maisLotes = lotes.length > N_LOTES ? `<button class="mais" data-exp="fx-lotes">${expandido["fx-lotes"] ? "Ver menos" : `Ver mais (${lotes.length})`}</button>` : "";
  const tabLotes = `<table class="tabela fx-lotes"><thead><tr><th>Chegada</th><th>Bol.</th><th>Lula</th><th>× 1º turno</th><th>Abst.</th></tr></thead><tbody>` +
    lotesVis.map((l) => `<tr><td><b>${hora(l.de)}</b><small>${esc(listaPaises(l.paises, 2))}</small></td><td>${l.boletins}</td>
      <td>${fmtP(l.lula_pct, 1)}</td><td>${fmtDelta(l.lula_pct != null && l.lula_1t_pct != null ? l.lula_pct - l.lula_1t_pct : null, 1, true)}</td>
      <td>${fmtP(l.abstencao_pct, 0)}<small>1º t. ${fmtP(l.abstencao_1t_pct, 0)}</small></td></tr>`).join("") + `</tbody></table>`;
  $("feed").innerHTML = `${resumo}<div class="fx-grade"><div><div class="fx-lista">${linhas}</div>${maisBU}</div>
    <div class="fx-lado"><div class="sub-h">Chegadas a cada 10 min</div><div class="fx-tab">${tabLotes}</div>${maisLotes}
    <p class="nota-leitura">Lula entre Lula e Flávio. Comparação com a mesma seção no 1º turno e em 2022; "média da cidade" (e *) só quando a seção não existia na outra eleição.</p></div></div>`;
}

// placar do exterior em números brutos, no topo da aba (inserido antes do mapa; só aparece na aba Exterior)
function renderPlacarExterior(pl) {
  let el = $("ext-placar");
  if (!el) {
    el = document.createElement("section");
    el.id = "ext-placar";
    el.className = "ext-placar";
    const palco = document.querySelector("#aba-mapa .palco");
    palco.parentNode.insertBefore(el, palco);
  }
  if (!pl) { el.innerHTML = ""; return; }
  const dif = (a, b) => { const d = a - b; return `<span class="xp-d">${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmtN(Math.abs(d))}</span>`; };
  const linhaVs = (nome, c, agora, antes, rotAntes) => `<div class="xp-l">${c ? marca(c) : `<i class="mk-m e"></i>`}<span class="n">${nome}</span>
    <b>${fmtN(agora)}</b><span class="a">${rotAntes} ${fmtN(antes)}</span>${dif(agora, antes)}</div>`;
  // agora × antes nas seções que existem nas duas eleições (casadas por município+zona+seção)
  const cmp = (v, titulo, rot, rotF) => `<div class="xp-card"><div class="rot">${titulo}</div>
    <div class="xp-sub">${fmtN(v.secoes)} de ${fmtN(pl.secoes)} seções apuradas existem nas duas</div>
    ${linhaVs("Lula", "l", v.lula, v.lula_antes, rot)}${linhaVs("Flávio", "f", v.flavio, v.flavio_antes, rotF)}
    ${linhaVs("Votaram", "", v.comparecimento, v.comparecimento_antes, rot)}</div>`;
  const pS = pl.secoes_tot ? (100 * pl.secoes) / pl.secoes_tot : 0, pE = pl.eleitorado ? (100 * pl.eleitores) / pl.eleitorado : 0;
  const pL = pl.validos ? (100 * pl.lula) / pl.validos : null, uh = pl.ultima_hora || {};
  const saldoC = pl.saldo > 0 ? "l" : pl.saldo < 0 ? "f" : "";
  el.innerHTML = `
    <div class="xp-card"><div class="rot">Apurado no exterior</div>
      <div class="xp-big">${fmtN(pl.secoes)}<small> de ${fmtN(pl.secoes_tot)} seções</small></div>
      <div class="xp-trilho"><i style="width:${pS}%"></i></div>
      <div class="xp-sub">${fmtP(pS)} das seções · ${fmtMi(pl.eleitores)} de ${fmtMi(pl.eleitorado)} eleitores (${fmtP(pE)}) · ${fmtN(pl.comparecimento)} votaram</div></div>
    <div class="xp-card"><div class="rot">Votos válidos contados</div>
      <div class="xp-big">${fmtN(pl.validos)}</div>
      ${pL == null ? "" : `<div class="xp-duelo"><span>${marca("l")}Lula <b>${fmtN(pl.lula)}</b></span><span>Flávio <b>${fmtN(pl.flavio)}</b>${marca("f")}</span></div>
      <div class="xp-barra"><i class="bl" style="width:${pL}%"></i><i class="bf"></i></div>`}
      <div class="xp-sub">${saldoC ? `${marca(saldoC)}${NOME_LADO[saldoC]} à frente por <b>${fmtN(Math.abs(pl.saldo))}</b> votos` : "empate"} · ${fmtN(pl.brancos)} brancos · ${fmtN(pl.nulos)} nulos</div></div>
    ${cmp(pl.vs_1t, "Mesmas seções × 1º turno 2026", "1º t.", "1º t.")}
    ${cmp(pl.vs_2022, "Mesmas seções × 2º turno 2022", "2022", "Bolsonaro")}
    <div class="xp-card"><div class="rot">Última hora</div>
      <div class="xp-big">+${fmtN(uh.secoes)}<small> seções</small></div>
      <div class="xp-l">${marca("l")}<span class="n">Lula</span><b>+${fmtN(uh.lula)}</b></div>
      <div class="xp-l">${marca("f")}<span class="n">Flávio</span><b>+${fmtN(uh.flavio)}</b></div>
      <div class="xp-sub">pela hora em que o TSE recebeu</div></div>`;
}

// ================================================================ Brasil: feed e análises (agente B)
const brCor = (quem) => (quem === "l" ? "var(--lula)" : quem === "f" ? "var(--flavio)" : "var(--ref)");
const brDot = (quem) => `<i class="br-dot" style="background:${brCor(quem)}"></i>`;
const brVS = (x) => (x == null ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + fmtMi(Math.abs(x)));
const brQuem = (x, tol = 0) => (x == null || Math.abs(x) <= tol ? "" : x > 0 ? "l" : "f");
const brNome = (q) => (q === "l" ? "Lula" : "Flávio");
// chip: rótulo + diferença em pp; a marca mostra a quem a diferença favorece
function brChip(rot, pp, quem, titulo = "") {
  if (pp == null) return "";
  return `<span class="br-chip" title="${esc(titulo)}">${quem ? brDot(quem) : ""}${rot} ${fmtPP(pp)}</span>`;
}
function brVazio(titulo, texto) {
  return `<section class="painel"><header><h2>${titulo}</h2></header><div class="vazio">${texto}</div></section>`;
}
function brBarraLF(pct) {
  return pct == null ? `<span class="br-lf vazio-b"></span>`
    : `<span class="br-lf"><i style="width:${pct}%;background:var(--lula)"></i><i style="background:var(--flavio)"></i></span>`;
}

// ---- o que acabou de entrar
function renderFeedBrasil(est) {
  try { brFeed(est); } catch (e) {
    console.error("feed do Brasil:", e);
    $("feed-sub").textContent = "";
    $("feed").innerHTML = `<div class="vazio">Não deu para montar o feed agora; tenta de novo na próxima atualização.</div>`;
  }
}
function renderAnaliseBrasil(est) {
  try { brAnalise(est); } catch (e) {
    console.error("análises do Brasil:", e);
    $("br-analise").innerHTML = brVazio("Análises do Brasil", "Não deu para montar as análises agora; tenta de novo na próxima atualização.");
  }
}
function brFeed(est) {
  const a = est.brasil?.analise;
  $("feed-titulo").textContent = "O que acabou de entrar";
  if (est.fase !== "apurando" || !a) {
    $("feed-sub").textContent = "";
    $("feed").innerHTML = `<div class="vazio">Aparece às 17h: cada atualização do TSE, município a município, comparada com o 1º turno e com 2022.</div>`;
    return;
  }
  const lt = (a.lotes || [])[0], ents = a.entradas || [];
  if (!lt || !ents.length) {
    $("feed-sub").textContent = "";
    $("feed").innerHTML = `<div class="vazio">Esperando a primeira atualização com votos por município.</div>`;
    return;
  }
  $("feed-sub").textContent = `arquivos dos municípios gerados pelo TSE às ${lt.hg || "—"} · ${fmtN(lt.total.municipios)} municípios · ${fmtN(lt.total.secoes)} seções`;
  const t = lt.total, v1a = t.validos_1a_leitura || 0;
  const primeira = v1a <= 0 ? "" : v1a >= 0.995 * t.validos
    ? `<span class="br-chip" title="Municípios lidos pela primeira vez: o voto pode ter vindo em várias atualizações do TSE até a leitura">todos em 1ª leitura</span>`
    : `<span class="br-chip" title="Municípios lidos pela primeira vez: o voto pode ter vindo em várias atualizações do TSE até a leitura">${fmtMi(v1a)} em 1ª leitura (${fmtN(t.municipios_1a_leitura)} municípios)</span>`;
  let h = `<div class="br-lote"><div class="br-lote-tot"><span class="k">Neste lote</span>
      <b>${fmtMi(t.validos)}</b> válidos · Lula <b>${fmtP(t.lula_pct)}</b>
      <span class="br-chip">${brDot(brQuem(t.dif_pp, 0.05))}${fmtPP(t.dif_pp)} vs esperado</span>${primeira}</div>
    <div class="br-lote-regs">${lt.regioes.map((r) => `<div class="br-lote-reg">
      <span class="n">${esc(r.regiao)}</span><span class="v">${fmtN(100 * r.validos / t.validos)}% dos votos</span>
      ${brBarraLF(r.lula_pct)}<span class="v">Lula ${fmtP(r.lula_pct)} ${brChip("", r.dif_pp, brQuem(r.dif_pp, 0.05), "Lula neste lote × o esperado pelo 1º turno (com a transferência da 3ª via) nos mesmos municípios")}</span>
    </div>`).join("")}</div></div>`;
  const lista = expandido["br-feed"] ? ents : ents.slice(0, 10);
  h += `<div class="br-feed">${lista.map((e) => {
    const t1 = e.dif_1t || {}, t22 = e.dif_2022 || {};
    // abstenção maior num município onde Lula ganha prejudica Lula (e vice-versa)
    const qAb = (d) => (d == null || Math.abs(d) < 0.05 ? "" : (d > 0) === (e.lula_pct >= 50) ? "f" : "l");
    const sec = e.primeira
      ? (e.completo ? `1ª leitura · ${fmtN(e.secoes)} seções, todas` : `1ª leitura · ${fmtN(e.secoes_apur)}/${fmtN(e.secoes_tot)} seções`)
      : `+${fmtN(e.secoes)} seções · ${fmtN(e.secoes_apur)}/${fmtN(e.secoes_tot)}`;
    const [pl, pf] = e.lula_pct == null ? [null, null] : par(e.lula_pct, 1);
    return `<div class="br-item">
      <div class="br-mun"><b>${esc(e.nome)}</b> <span class="muted">${e.uf}</span><small>${esc(e.regiao)} · ${(e.hg || "").slice(0, 5)} · ${sec}</small></div>
      <div class="br-voto">${brBarraLF(e.lula_pct)}<span><b>${fmtP(pl)}</b> × ${fmtP(pf)} <span class="muted">· ${fmtN(e.lula + e.flavio)} válidos</span></span></div>
      <div class="br-abs"><span class="k">abstenção</span> <b>${fmtP(e.abstencao_pct)}</b></div>
      <div class="br-chips">
        ${e.t1 ? brChip("1º turno: Lula", t1.lula_pp, brQuem(t1.lula_pp, 0.05), `No 1º turno o município deu ${fmtP(e.t1.lula_pct)} a Lula entre os dois; 3ª via ${fmtP(e.t1.outros_pct)}`) : ""}
        ${e.t1 ? brChip("abst.", t1.abstencao_pp, qAb(t1.abstencao_pp), `Abstenção no 1º turno: ${fmtP(e.t1.abstencao_pct)}`) : ""}
        ${e.t1 && e.t1.outros_pct >= 1 ? `<span class="br-chip" title="Votos dos outros candidatos no 1º turno, neste município">3ª via ${fmtP(e.t1.outros_pct, 0)}</span>` : ""}
        ${e.t22 ? brChip("2022: Lula", t22.lula_pp, brQuem(t22.lula_pp, 0.05), `Em 2022 (2º turno): Lula ${fmtP(e.t22.lula_pct)}, abstenção ${fmtP(e.t22.abstencao_pct)}`) : ""}
        ${e.t22 ? brChip("abst.", t22.abstencao_pp, qAb(t22.abstencao_pp), `Abstenção em 2022: ${fmtP(e.t22.abstencao_pct)}`) : ""}
      </div></div>`;
  }).join("")}</div>`;
  if (ents.length > 10) h += `<button class="mais" data-exp="br-feed">${expandido["br-feed"] ? "Mostrar menos" : `Mostrar os ${ents.length} mais recentes`}</button>`;
  h += `<p class="nota-leitura">Cada linha são as urnas que acabaram de entrar no município; o lote junta os arquivos de município que o TSE gerou no mesmo minuto. "1ª leitura": tudo o que o município tinha quando foi lido pela primeira vez. A comparação é com o município inteiro no 1º turno e em 2022 (o TSE não publica seção a seção na totalização). A marca colorida mostra a quem a diferença favorece.</p>`;
  $("feed").innerHTML = h;
}

// ---- análises: origem dos votos, abstenção, 3ª via
function brLinhas(a, chave, linha, soContadas = false) {
  // uma linha por região (botão abre as UFs) + UFs quando aberta
  return a.regioes.filter((r) => r.eleitorado > 0 && (!soContadas || r.municipios > 0)).map((r) => {
    const k = `br-${chave}-${r.regiao}`, aberto = !!expandido[k], temUf = r.ufs && r.ufs.length > 1;
    const nome = temUf ? `<button class="br-abre" data-exp="${k}" aria-expanded="${aberto}"><span class="seta">${aberto ? "−" : "+"}</span>${esc(r.regiao)}</button>` : `<span class="br-abre sem">${esc(r.regiao)}</span>`;
    return linha(r, nome, "br-reg") + (aberto ? r.ufs.map((u) => linha(u, `<span class="br-uf"><span class="nm">${esc(u.nome)} </span><span class="muted">${u.uf}</span></span>`, "br-ufl")).join("") : "");
  }).join("");
}
function brOrigem(a) {
  const g = a.geografia || {}, pux = g.puxado_pp;
  const max = Math.max(...a.regioes.flatMap((r) => [r.parcela_contado_pct || 0, r.parcela_esperada_pct || 0]), 1);
  const linha = (r, nome, cls) => `<tr class="${cls}"><td>${nome}</td>
    <td class="br-barras"><span class="br-par"><i class="c" style="width:${(100 * (r.parcela_contado_pct || 0)) / max}%"></i></span><span class="br-par"><i class="e" style="width:${(100 * (r.parcela_esperada_pct || 0)) / max}%"></i></span></td>
    <td><b>${fmtP(r.parcela_contado_pct)}</b><small>${fmtP(r.parcela_esperada_pct)}</small></td>
    <td class="opc">${fmtP(r.apurado_pct, 0)}</td>
    <td class="opc">${fmtP(r.lula_pct)}</td><td class="opc">${fmtP(r.lula_1t_pct)}</td>
    <td>${r.lula_dif_1t_pp == null ? "—" : `${brDot(brQuem(r.lula_dif_1t_pp, 0.05))}${fmtPP(r.lula_dif_1t_pp)}`}</td></tr>`;
  const frase = pux == null ? "" : Math.abs(pux) < 0.3
    ? `As urnas já contadas votaram como o Brasil no 1º turno (${fmtP(g.lula_1t_contado_pct)} para Lula entre os dois): a parcial não está puxada pela geografia.`
    : `No 1º turno, as urnas já contadas deram <b>${fmtP(g.lula_1t_contado_pct)}</b> a Lula entre os dois, contra ${fmtP(g.lula_1t_brasil_pct)} no Brasil: a parcial está puxada <b>${fmtPP(Math.abs(pux))}</b> para ${brDot(pux > 0 ? "l" : "f")}<b>${pux > 0 ? "Lula" : "Flávio"}</b> só pela geografia do que já entrou.`;
  return `<section class="painel"><header><h2>De onde vêm os votos</h2><p>parcela dos válidos já contados × peso no 1º turno</p></header>
    <p class="br-frase">${frase}</p>
    <div class="br-legenda br-leg"><span><i class="c"></i>parcela no contado</span><span><i class="e"></i>parcela no 1º turno (válidos)</span></div>
    <div class="tabela-wrap br-wrap"><table class="tabela br-t"><thead><tr><th>Região</th><th></th>
      <th>Parcela<small>1º turno</small></th><th class="opc">Apurado</th><th class="opc">Lula agora</th><th class="opc">1º turno*</th><th>Lula vs 1º turno*</th></tr></thead>
      <tbody>${brLinhas(a, "o", linha)}</tbody></table></div>
    <p class="nota-leitura">* Lula entre os dois no 1º turno, nas mesmas urnas (a fração apurada de cada município aplicada ao resultado dele). Clique numa região para abrir os estados.</p></section>`;
}
function brAbstencao(a, cedo, min) {
  const ef = a.abstencao_efeito || {}, t = a.total;
  const max = Math.max(...a.regioes.map((r) => Math.abs(r.efeito_abstencao_votos || 0)), 1);
  const linha = (r, nome, cls) => {
    const v = r.efeito_abstencao_votos || 0, w = Math.min(50, (50 * Math.abs(v)) / max);
    const bar = v >= 0 ? `left:50%;width:${w}%;background:var(--lula)` : `left:${50 - w}%;width:${w}%;background:var(--flavio)`;
    return `<tr class="${cls}"><td>${nome}</td><td><b>${fmtP(r.abstencao_pct)}</b></td><td class="opc">${fmtP(r.abstencao_1t_pct)}</td><td class="opc">${fmtP(r.abstencao_2022_pct)}</td>
      <td>${fmtPP(r.abstencao_dif_1t_pp)}</td>
      <td>${cedo ? `<span class="muted">—</span>` : `<span class="saldo"><span class="br-ef">${r.municipios ? `${brVS(v)}` : "—"}</span><span class="br-div"><i style="${bar}"></i></span></span>`}</td></tr>`;
  };
  const q = brQuem(ef.votos, 500), dAb = t.abstencao_dif_1t_pp;
  const pp = (x) => `${Math.abs(x).toFixed(1).replace(".", ",")} pp`;
  const efeito = cedo ? `O efeito no saldo aparece com ${fmtP(min, 0)} apurado; antes disso ele mede mais a ordem de apuração do que a abstenção.`
    : q ? `Pelo lugar onde isso aconteceu, rende <b>${fmtMi(Math.abs(ef.votos))}</b> votos de saldo para ${brDot(q)}<b>${brNome(q)}</b> (${fmtPP(Math.abs(ef.pp), 2)} na fatia).` : "Pelo lugar onde isso aconteceu, não favorece ninguém.";
  const frase = ef.votos == null || dAb == null ? "" : `${Math.abs(dAb) < 0.05 ? "A abstenção está igual à" : dAb > 0 ? `A abstenção subiu <b>${pp(dAb)}</b> em relação ao` : `A abstenção caiu <b>${pp(dAb)}</b> em relação ao`} 1º turno nas mesmas urnas
    (${fmtMi(Math.abs(ef.comparecimento_extra))} eleitores ${ef.comparecimento_extra >= 0 ? "a mais" : "a menos"}). ${efeito}`;
  return `<section class="painel"><header><h2>Abstenção: quem ela prejudica</h2><p>mesmas urnas</p></header>
    <p class="br-frase">${frase}</p>
    <div class="tabela-wrap br-wrap"><table class="tabela br-t"><thead><tr><th>Região</th><th>Agora</th><th class="opc">1º turno</th><th class="opc">2022</th><th>vs 1º turno</th><th>Efeito no saldo</th></tr></thead>
      <tbody>${brLinhas(a, "a", linha, true)}</tbody></table></div>
    <p class="nota-leitura">Efeito: saldo de agora menos o saldo se cada município tivesse comparecido como no 1º turno, votando como está votando. Abstenção que sobe igual em todo lugar não mexe na fatia; pesa quando sobe mais onde um candidato é mais forte. Em municípios ainda parciais, parte da diferença é só a ordem em que as seções entram.</p></section>`;
}
const BR_DEST = [["lula", "Lula", "var(--lula)"], ["flavio", "Flávio", "var(--flavio)"], ["brancos_nulos", "Branco e nulo", "var(--a2)"], ["abstencao", "Abstenção", "var(--a3)"]];
function brTerceira(a, cedo, min) {
  if (cedo) return brVazio("Para onde foi a 3ª via", `Aparece com ${fmtP(min, 0)} apurado: antes disso, com quase todo município parcial, a conta mede mais a ordem de apuração do que o voto.`);
  const somas = a.regioes.filter((r) => r.outros_1t > 0).map((r) => {
    const v = BR_DEST.map(([k]) => r.destino[k] || 0);
    return [v.filter((x) => x < 0).reduce((s, x) => s + x, 0), v.filter((x) => x > 0).reduce((s, x) => s + x, 0)];
  });
  const lo = Math.min(0, ...somas.map((s) => s[0])), hi = Math.max(100, ...somas.map((s) => s[1]));
  const X = (v) => (100 * (Math.max(lo, Math.min(hi, v)) - lo)) / (hi - lo);
  const barra = (r) => {
    if (!(r.outros_1t > 0) || !r.municipios) return `<span class="br-emp vazio-b"></span>`;
    let pos = 0, neg = 0, h = "";
    for (const [k, nome, cor] of BR_DEST) {
      const v = r.destino[k] || 0;
      const a0 = v >= 0 ? pos : neg + v, a1 = v >= 0 ? pos + v : neg;
      if (v >= 0) pos += v; else neg += v;
      h += `<i title="${nome}: ${fmtP(v, 0)}" style="left:${X(a0)}%;width:${Math.max(0, X(a1) - X(a0))}%;background:${cor}${v < 0 ? ";opacity:.55" : ""}"></i>`;
    }
    return `<span class="br-emp"><b class="zero" style="left:${X(0)}%"></b><b class="cem" style="left:${X(100)}%"></b>${h}</span>`;
  };
  const linha = (r, nome, cls) => `<tr class="${cls}"><td>${nome}</td><td class="opc">${r.outros_1t > 0 ? fmtMi(r.outros_1t) : "—"}</td>
    <td class="br-empc">${barra(r)}</td>
    <td>${r.lula_entre_os_dois_pct == null ? "—" : fmtP(r.lula_entre_os_dois_pct, 0)}</td><td class="opc">${r.alpha_pct == null || cls === "br-ufl" ? "" : fmtP(r.alpha_pct, 0)}</td></tr>`;
  const t = a.total, d = t.destino || {};
  const frase = t.outros_1t > 0 ? `Nas urnas contadas, os outros candidatos tiveram <b>${fmtMi(t.outros_1t)}</b> votos no 1º turno. Do 1º para o 2º turno:
    ${BR_DEST.map(([k, n]) => `${k === "lula" || k === "flavio" ? n : n.toLowerCase()} <b>${brVS(t.destino_votos[k])}</b>`).join(", ")}.` : "";
  return `<section class="painel"><header><h2>Para onde foi a 3ª via</h2><p>contabilidade nas mesmas urnas</p></header>
    <p class="br-frase">${frase}</p>
    <div class="br-legenda">${BR_DEST.map(([k, n, c]) => `<span><i style="background:${c}"></i>${n} ${fmtP(d[k], 0).replace("-", "−")}</span>`).join("")}</div>
    <div class="tabela-wrap br-wrap"><table class="tabela br-t"><thead><tr><th>Região</th><th class="opc">3ª via no 1º turno</th><th class="br-empc">variação, em % dos votos da 3ª via</th><th>Lula entre os dois</th><th class="opc">Regressão</th></tr></thead>
      <tbody>${brLinhas(a, "t", linha, true)}</tbody></table></div>
    <p class="nota-leitura">Quanto Lula, Flávio, brancos e nulos e a abstenção variaram do 1º para o 2º turno, como fração dos votos da 3ª via. É conta agregada, não fluxo de eleitores: quem votou em Lula no 1º turno pode ter faltado e ser compensado por outro. A linha marca 0% e 100%. Em municípios ainda parciais, parte do número é ordem de apuração. Regressão: a parte da 3ª via que foi para Lula estimada entre municípios, a que a projeção usa.</p></section>`;
}
function brAnalise(est) {
  const a = est.brasil?.analise, el = $("br-analise");
  if (est.fase !== "apurando" || !a || !a.total?.validos) {
    el.innerHTML = brVazio("De onde vêm os votos", "Aparece às 17h: quanto do contado vem de cada região, comparado com o peso dela no 1º turno.")
      + `<div class="br-dupla">${brVazio("Abstenção: quem ela prejudica", "Aparece às 17h: abstenção agora × 1º turno × 2022 e o efeito no saldo.")}${brVazio("Para onde foi a 3ª via", "Aparece às 17h: o que mudou do 1º para o 2º turno, região a região.")}</div>`;
    return;
  }
  const min = est.min_apurado ?? 5, cedo = !(a.total.apurado_pct >= min);
  el.innerHTML = brOrigem(a) + `<div class="br-dupla">${brAbstencao(a, cedo, min)}${brTerceira(a, cedo, min)}</div>`;
}

// ================================================================ método (recolhido)
function metodo(p, escopo, est) {
  if (!p || !p.contado || p.lula_pct == null) return `<p class="vazio">Aparece junto com a projeção.</p>`;
  const br = escopo === "brasil", u = br ? "município" : "cidade", us = br ? "municípios" : "cidades";
  const alfa = p.alpha_regiao ? Object.entries(p.alpha_regiao).map(([r, a]) => `${r} ${fmtP(a, 0)}`).join(" · ") : "";
  let h = `<div class="passos3">
    <div class="passo"><div class="n">1 · Base</div><div class="big">${fmtN(p.municipios.completos + p.municipios.parciais)} ${us}</div>
      <p>já têm voto. Cada ${u} tem uma base: Lula no 1º turno + a parte dos votos dos outros candidatos que foi para ele nas urnas já contadas${alfa ? ` (${alfa})` : ""}.</p></div>
    <div class="passo"><div class="n">2 · Desvio</div><div class="big">${fmtPP(p.desvio_medio_pp)}</div>
      <p>é quanto Lula está, em média, acima ou abaixo da base onde já se contou. Cada ${u} que falta recebe a sua base + o desvio ${br ? "do seu estado (puxado para a região quando o estado tem pouco voto)" : "médio do exterior"}.</p></div>
    <div class="passo"><div class="n">3 · Incerteza</div><div class="big">${fmtP(p.p10)}–${fmtP(p.p90)}</div>
      <p>é a faixa em 80% de ${br ? 300 : 200} simulações, que sorteiam de novo as urnas contadas e somam um erro extra a cada ${br ? "estado" : "país"} que falta. A faixa fecha conforme a apuração avança.</p></div>
  </div>`;
  const en = est.ensaio_2022;
  if (br && en && en.pontos?.length) {
    h += `<h3>O mesmo método na apuração de 2022</h3><p class="cascata-nota" style="margin:0 0 8px">Apuração do 2º turno de 2022 refeita zona a zona, cidades pequenas primeiro, com o 1º turno como base.
      O contado começou com Lula em ${fmtP(en.pontos[0].parcial)} e foi caindo; a projeção ficou perto do resultado real (${fmtP(en.real, 2)}) desde o começo.</p>
      <div id="ensaio" class="grafico" style="height:230px"></div>`;
  }
  return h;
}

// ================================================================ escopo Brasil / Exterior
async function renderMapa(est) {
  const br = aba === "brasil", chave = br ? "br" : "mundo";
  if (!SVG[chave]) {
    const g = await garantirGeo(chave);
    if (!SVG[chave]) SVG[chave] = br ? montarBR(g) : montarMundo(g);
  }
  const box = $("mapa");
  if (box.firstChild !== SVG[chave]) { box.replaceChildren(SVG[chave]); box.classList.toggle("mundo", !br); }
  // modos
  const escopo = br ? "brasil" : "exterior";
  const ok = br ? brOk() : !!est.exterior?.modelos?.[MODELO]?.disponivel;
  let m = modo[escopo];
  if (!ok && (m === "proj" || m === "desvio")) m = br && est.fase !== "apurando" ? "t1" : "contado";
  $("modos").innerHTML = Object.entries(MODOS).map(([k, v]) =>
    `<button data-modo="${k}" aria-pressed="${k === m}" ${!ok && (k === "proj" || k === "desvio") ? "disabled title='Aparece com a projeção'" : ""}>${v.rot}</button>`).join("");
  $("mapa-acoes").innerHTML = br
    ? (sel.brasil ? `<button class="chip-btn" data-sel="">← Brasil inteiro</button>` : "")
    : PRESETS.map((p) => `<button class="chip-btn" data-preset="${p.id}">${p.rot}</button>`).join("");
  $("legenda-mapa").innerHTML = legenda(m);
  const notas = {
    proj: br ? "Cada município pintado pelo resultado que esperamos no fim: contado onde já há voto, projetado onde falta." : "Cada país pelo resultado que esperamos no fim. Bolhas proporcionais ao eleitorado.",
    contado: "Só o que já foi contado. Cinza: ainda sem votos.",
    desvio: "Lula agora × a base (1º turno + transferência), onde já há voto. É esse desvio que a projeção leva para o que falta.",
    andamento: br ? "Quanto de cada município já foi apurado." : "Quanto das seções de cada país já chegou.",
    t1: "Lula × Flávio no 1º turno de 2026, só entre os dois. É a referência da projeção.",
  };
  $("mapa-nota").textContent = notas[m];
  const modoEfetivo = modo[escopo]; modo[escopo] = m;
  if (br) pintarBR(); else pintarMundo();
  modo[escopo] = modoEfetivo;
}

function renderBrasil(est) {
  const b = est.brasil || {}, P = b.modelos || {}, p = P[MODELO], alt = P[MODELO_ALT];
  MUN = {}; for (const r of b.mapa || []) MUN[r[0]] = r;
  const ok = brOk(), n = est.nacional, mk = est.mercados || {};
  $("veredito").innerHTML = veredito(p, alt, "brasil", est);
  const cas = ok ? passosCascata(p, agruparRegioes(p.por_uf), (g) => g.grupo) : null;
  $("contado").innerHTML = est.fase === "apurando"
    ? blocoContado("", `${fmtP(n.apurado_pct, 1)} das urnas · TSE ${n.hg?.slice(0, 5) || ""}`, n.lula, n.validos, ok ? frasePorque(cas) : "Com tão pouco contado, quem chegou primeiro ainda pesa demais.")
    : blocoContado(`O TSE começa a totalizar às 17h. Até lá o exterior é contado boletim a boletim: veja a aba <a href="#exterior">Exterior</a>.`, "", 0, 0);
  $("chances").innerHTML = blocoChances(ok ? p.prob_lula : null, mk.polymarket?.p_lula, mk.kalshi?.p_lula, "Brasil");
  // seleção
  const u = sel.brasil;
  if (u) {
    const g = (p?.por_uf || []).find((x) => x.grupo === u), r1 = (b.por_uf || []).find((x) => x.uf.toLowerCase() === u);
    $("selecao").innerHTML = `<div class="nome-sel">${esc(r1?.nome || u.toUpperCase())}</div>
      <div class="sub-sel">${fmtP(g?.apurado_pct ?? r1?.apurado_pct, 1)} apurado · ${fmtMi(g?.eleitorado)} eleitores</div>
      <div class="grade-sel">
        <div><span class="k">Lula no contado</span><span class="v">${fmtP(g?.lula_contado_pct)}</span></div>
        <div><span class="k">Lula projetado</span><span class="v">${ok ? fmtP(g?.lula_final_pct) : "—"}</span></div>
        <div><span class="k">1º turno, mesmas urnas*</span><span class="v">${fmtP(r1?.lula_1t_pct)}</span></div>
        <div><span class="k">Saldo do que falta</span><span class="v ${sinal(g?.saldo_esperado)}">${ok ? fmtS(g?.saldo_esperado) : "—"}</span></div>
      </div><p class="selecao dica" style="margin:10px 0 0">* entre Lula e Flávio</p>`;
  } else {
    $("selecao").innerHTML = `<h3>Explorar</h3><p class="dica">Passe o mouse num município para ver os números. Clique para abrir o estado.</p>`;
  }
  $("cascata-titulo").textContent = "Do contado à projeção";
  $("cascata-sub").textContent = ok ? "o que falta de cada região, somado ao contado" : "";
  $("cascata").innerHTML = ok ? cascata(cas) + `<p class="cascata-nota">Cada linha soma ao contado os votos que ainda faltam de uma região, com a fatia que esperamos de Lula ali.</p>` : `<div class="vazio">Aparece com 5% do eleitorado apurado, depois das 17h.</div>`;
  const hist = (b.hist || []).filter((h) => h.modelo === MODELO);
  $("noite-sub").textContent = hist.length ? `${hist.length} atualizações do TSE` : "";
  grafico($("noite"), {
    aria: "Projeção e contado ao longo da apuração", vazio: "Começa com a primeira totalização do TSE, às 17h. Cada atualização vira um ponto: o contado e a projeção com a faixa.",
    xFmt: (v) => fmtP(v, 0) + " apurado", xMin: 0, refs: [{ y: 50, label: "50%" }],
    series: [
      { nome: "Contado", cor: "var(--parcial)", pts: hist.map((h) => ({ x: h.apurado, y: h.parcial })) },
      { nome: "Projeção", cor: "var(--lula)", banda: true, pts: hist.map((h) => ({ x: h.apurado, y: h.p50, lo: h.p10, hi: h.p90 })) },
    ],
  });
  // tabela
  $("tabela-titulo").textContent = "Estados";
  if (ok) {
    const g = (p.por_uf || []).slice();
    $("tabela-sub").textContent = "ordenados pelo peso no resultado · clique para ver no mapa";
    $("tabela").innerHTML = cabTabela("Estado") + `<tbody>${g.map((x) => linhaTabela(x.grupo, x.nome, x.grupo === "zz" ? "" : x.grupo.toUpperCase(), x.apurado_pct, x.lula_contado_pct, x.lula_final_pct, x.saldo_esperado, maxSaldo(g))).join("")}</tbody>`;
  } else {
    $("tabela-sub").textContent = "";
    $("tabela").innerHTML = `<tbody><tr><td class="vazio">Aparece com a projeção, depois das 17h.</td></tr></tbody>`;
  }
  $("tabela-mais").innerHTML = "";
  renderFeedBrasil(est);
  $("br-analise").hidden = false;
  renderAnaliseBrasil(est);
  renderMetodo(p, "brasil", est);
}

function cabTabela(rot) {
  return `<thead><tr><th>${rot}</th><th>Apurado</th><th>Lula no contado</th><th>Lula projetado</th><th>Saldo do que falta</th></tr></thead>`;
}
const maxSaldo = (g) => Math.max(...g.map((x) => Math.abs(x.saldo_esperado || 0))) || 1;
function linhaTabela(chave, nome, sub, ap, contado, proj, saldo, max) {
  const w = (50 * Math.abs(saldo || 0)) / max;
  const bar = saldo >= 0 ? `left:50%;width:${w}%;background:var(--lula)` : `left:${50 - w}%;width:${w}%;background:var(--flavio)`;
  const cls = (v) => (v == null ? "" : v >= 50 ? "pct-l" : "pct-f");
  const atual = aba === "exterior" ? sel.exterior : sel.brasil;
  return `<tr data-sel="${esc(chave)}" class="${atual === chave ? "on" : ""}"><td class="nome"><b>${esc(nome)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</td>
    <td><span class="ap">${fmtP(ap, 0)}<i><b style="width:${ap || 0}%"></b></i></span></td>
    <td class="${cls(contado)}">${fmtP(contado)}</td><td class="${cls(proj)}">${fmtP(proj)}</td>
    <td><span class="saldo"><span class="${sinal(saldo)}">${fmtS(saldo)}</span><span class="div"><i style="${bar}"></i></span></span></td></tr>`;
}

function renderExterior(est) {
  const x = est.exterior || {}, P = x.modelos || {}, p = P[MODELO], alt = P[MODELO_ALT], mk = est.mercados || {};
  const ok = !!(p && p.disponivel && p.lula_pct != null);
  const proj = {}; for (const g of p?.por_pais || []) proj[g.grupo] = g;
  PAIS = {}; for (const r of x.paises || []) if (r.iso3) PAIS[r.iso3] = { ...r, proj: ok ? proj[r.pais] : null };
  $("veredito").innerHTML = veredito(p, alt, "exterior", est);
  const cas = ok ? passosCascata(p, agruparPaises(p.por_pais), (g) => g.grupo) : null;
  const mu = x.mesmas_urnas || {};
  $("contado").innerHTML = blocoContado("Ainda sem boletins do exterior.", `${fmtN(x.secoes)} de ${fmtN(x.secoes_tot)} seções · último ${hora(x.ultimo_bu)}`, mu.lula, mu.validos,
    ok ? frasePorque(cas) : "");
  $("chances").innerHTML = blocoChances(ok ? p.prob_lula : null, mk.polymarket?.exterior_lula, mk.kalshi?.exterior_lula, "no exterior");
  const s = sel.exterior && PAIS[sel.exterior];
  if (s) {
    $("selecao").innerHTML = `<div class="nome-sel">${esc(s.pais)}</div>
      <div class="sub-sel">${s.secoes} de ${s.secoes_tot} seções · ${fmtN(s.eleitorado)} eleitores</div>
      <div class="grade-sel">
        <div><span class="k">Lula no contado</span><span class="v">${s.secoes ? fmtP(s.lula_pct) : "—"}</span></div>
        <div><span class="k">Lula projetado</span><span class="v">${s.proj ? fmtP(s.proj.lula_final_pct) : "—"}</span></div>
        <div><span class="k">1º turno*</span><span class="v">${fmtP(s.lula_1t_final_2v_pct)}</span></div>
        <div><span class="k">Saldo do que falta</span><span class="v ${sinal(s.proj?.saldo_esperado)}">${s.proj ? fmtS(s.proj.saldo_esperado) : "—"}</span></div>
      </div><p class="dica" style="margin:10px 0 0">* entre Lula e Flávio, no país inteiro</p>`;
  } else {
    $("selecao").innerHTML = `<h3>Explorar</h3><p class="dica">Passe o mouse num país ou numa bolha. Clique para aproximar. A bolha é proporcional ao eleitorado.</p>`;
  }
  $("cascata-titulo").textContent = "Do contado à projeção";
  $("cascata-sub").textContent = ok ? "o que falta dos países que mais pesam" : "";
  $("cascata").innerHTML = ok ? cascata(cas) + `<p class="cascata-nota">Cada linha soma ao contado os votos que ainda faltam de um país, com a fatia que esperamos de Lula ali.</p>` : `<div class="vazio">Aparece com 2% do eleitorado do exterior apurado.</div>`;
  const h = x.hist || [];
  $("noite-sub").textContent = "hora em que o TSE recebeu cada boletim";
  grafico($("noite"), {
    aria: "Projeção do exterior ao longo do dia", xFmt: fmtHora, refs: [{ y: 50, label: "50%" }],
    series: [
      { nome: "Contado", cor: "var(--parcial)", pts: h.map((r) => ({ x: tms(r.t), y: r.parcial, extra: `${r.secoes} seções` })) },
      { nome: "Projeção", cor: "var(--lula)", banda: true, pts: h.map((r) => ({ x: tms(r.t), y: r.p50, lo: r.p10, hi: r.p90 })) },
    ],
  });
  // tabela de países
  const linhas = Object.values(PAIS).map((r) => ({ ...r, saldo: r.proj?.saldo_esperado ?? 0 }))
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo) || b.eleitorado - a.eleitorado);
  const max = Math.max(...linhas.map((r) => Math.abs(r.saldo))) || 1;
  const lista = expandido.paises ? linhas : linhas.slice(0, 15);
  $("tabela-titulo").textContent = "Países";
  $("tabela-sub").textContent = `${linhas.filter((r) => r.secoes).length} de ${linhas.length} com boletim · clique para ver no mapa`;
  $("tabela").innerHTML = cabTabela("País") + `<tbody>${lista.map((r) => linhaTabela(r.iso3, r.pais, `${r.secoes}/${r.secoes_tot}`,
    r.secoes_tot ? (100 * r.secoes) / r.secoes_tot : 0, r.secoes ? r.lula_pct : null, r.proj?.lula_final_pct, ok ? r.saldo : null, max)).join("")}</tbody>`;
  $("tabela-mais").innerHTML = linhas.length > 15 ? `<button class="mais" data-exp="paises">${expandido.paises ? "Mostrar só os 15 maiores" : `Mostrar todos (${linhas.length})`}</button>` : "";
  renderFeedExterior(est);
  $("br-analise").hidden = true;
  renderMetodo(p, "exterior", est);
}

function renderMetodo(p, escopo, est) {
  const det = $("metodo");
  if (!det.open) { det.dataset.sujo = "1"; return; }
  $("metodo-corpo").innerHTML = metodo(p, escopo, est);
  const en = est.ensaio_2022;
  if ($("ensaio") && en) {
    grafico($("ensaio"), {
      aria: "Ensaio com 2022", xFmt: (v) => fmtP(v, 0) + " apurado", xMin: 0, xMax: 100,
      refs: [{ y: en.real, label: `resultado real ${fmtP(en.real, 2)}`, cor: "var(--text-2)" }],
      series: [
        { nome: "Contado", cor: "var(--parcial)", pts: en.pontos.map((h) => ({ x: h.apurado, y: h.parcial })) },
        { nome: "Projeção", cor: "var(--lula)", banda: true, pts: en.pontos.map((h) => ({ x: h.apurado, y: h.p50, lo: h.p10, hi: h.p90 })) },
      ],
    });
  }
}

// ================================================================ Mercados: movimentos × exterior
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

const hhmm = (min) => {
  const d = Math.floor(min / 1440), m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${d < 0 ? "ontem " : ""}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const ultimo = (s, t) => { let v = null; for (const p of s) { if (p[0] > t) break; v = p[1]; } return v; };
const margemDe = (fatia) => (fatia == null ? null : 2 * fatia - 100);
const fmtMargem = (m, d = 1) => (m == null ? "—" : `${m >= 0 ? "Lula" : "Flávio"} por ${Math.abs(m).toFixed(d).replace(".", ",")} pp`);
// ---------- disputa binária: sempre os dois lados, o sentido dito pelo nome do candidato ----------
const NOME_LADO = { l: "Lula", f: "Flávio" };
const marca = (c) => `<i class="mk-m ${c}" aria-hidden="true"></i>`;
// chance/fatia de Lula (0–100) → o favorito e a chance dele
const favorito = (pL) => (pL == null ? null : Math.abs(pL - 50) < 0.05 ? { c: "e", nome: "Empate", v: 50, empate: true }
  : pL > 50 ? { c: "l", nome: "Lula", v: pL } : { c: "f", nome: "Flávio", v: 100 - pL });
// os dois lados arredondados somando 100
const par = (pL, dec = 0) => { const m = 10 ** dec, l = Math.round(pL * m) / m; return [l, Math.round((100 - l) * m) / m]; };
// variação medida a favor de Lula (d > 0) → "+1,0 pp para Flávio"; curto: "Flávio +1,0" (tabelas)
const fmtDelta = (d, dec = 1, curto = false) => {
  if (d == null) return `<span class="muted">—</span>`;
  const v = Math.abs(d).toFixed(dec).replace(".", ",");
  if (Math.abs(d) < 0.5 * 10 ** -dec) return `<span class="mk-d zero">${curto ? "0" : "sem mudança"}</span>`;
  const c = d > 0 ? "l" : "f";
  return `<span class="mk-d">${marca(c)}${curto ? `${NOME_LADO[c]} +${v}` : `+${v} pp para <b>${NOME_LADO[c]}</b>`}</span>`;
};
// barra dividida rotulada com os dois nomes
function barraDuelo(pL, dec = 0) {
  if (pL == null) return `<div class="mk-duelo"><div class="t nada"></div><div class="rots"><span>Lula —</span><span>Flávio —</span></div></div>`;
  const [l, f] = par(pL, dec);
  return `<div class="mk-duelo"><div class="t"><div class="bl" style="width:${pL}%"></div><div class="bf"></div></div>
    <div class="rots"><span>${marca("l")}Lula <b>${fmtP(l, dec)}</b></span><span>Flávio <b>${fmtP(f, dec)}</b>${marca("f")}</span></div></div>`;
}
const nomeOnda = (o, n = 3) => o.paises.slice(0, n).join(", ") + (o.paises.length > n ? ` +${o.paises.length - n}` : "");

// ---------- linha do tempo: painéis empilhados com o mesmo eixo de horário ----------
function linhaTempo(el, cfg) {
  // painéis com lados podem ter rótulos com nome no eixo ("Lula 55%"): margem esquerda maior
  const W = el.clientWidth || 900, m = { l: cfg.paineis.some((p) => p.lados) ? 76 : 48, r: 132, t: 22, gap: 26 };
  el.dataset.w = W;
  const x0 = cfg.x0, x1 = cfg.x1;
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  let y = m.t, svg = "";
  const geo = [];
  for (const p of cfg.paineis) {
    const h = p.h, ys = [];
    for (const s of p.series) for (const q of s.pts) if (q[0] >= x0 && q[0] <= x1) ys.push(q[1]);
    if (p.ref != null) ys.push(p.ref);
    let y0 = p.yMin ?? (ys.length ? Math.min(...ys) : 0), y1 = p.yMax ?? (ys.length ? Math.max(...ys) : 1);
    if (p.yMin == null || p.yMax == null) { const pad = Math.max(p.padMin ?? 0.5, (y1 - y0) * 0.15); if (p.yMin == null) y0 -= pad; if (p.yMax == null) y1 += pad; }
    const Y = (v) => y + (1 - (v - y0) / (y1 - y0 || 1)) * h;
    geo.push({ p, y, h, Y });
    // lados: fundo de cada lado da linha de empate (50% ou 0 pp) com a cor e o nome de quem está à frente ali
    if (p.lados) {
      const L = p.lados, yr = Math.max(y, Math.min(y + h, Y(L.ref)));
      for (const [a, b, s] of [[y, yr, L.acima], [yr, y + h, L.abaixo]]) {
        if (b - a < 1) continue;
        svg += `<rect x="${m.l}" y="${a}" width="${W - m.l - m.r}" height="${b - a}" fill="var(--${s.c === "l" ? "lula" : "flavio"})" opacity=".07"/>`;
        // no primeiro painel o topo é dos rótulos dos fechamentos: o nome do lado vai para o pé da faixa
        const noPe = s === L.abaixo || y === m.t;
        if (b - a >= 14) svg += `<text x="${m.l + 6}" y="${noPe ? b - 5 : a + 12}" font-size="10.5" font-weight="650" fill="var(--text-2)" stroke="var(--surface)" stroke-width="3" paint-order="stroke">${esc(s.rot)}</text>`;
      }
      if (L.ref >= y0 && L.ref <= y1) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(L.ref)}" y2="${Y(L.ref)}" stroke="var(--ref)" stroke-dasharray="4 3"/>
        <text x="${W - m.r - 4}" y="${Y(L.ref) - 4}" font-size="10" text-anchor="end" fill="var(--muted)">empate</text>`;
    }
    svg += `<text x="${m.l}" y="${y - 8}" font-size="12" font-weight="650" fill="var(--text)">${esc(p.titulo)}</text>`;
    if (p.sub && W >= 640) svg += `<text x="${W - m.r}" y="${y - 8}" font-size="11" text-anchor="end" fill="var(--muted)">${esc(p.sub)}</text>`;
    const passo = [0.25, 0.5, 1, 2, 5, 10, 20, 25, 50].find((q) => (y1 - y0) / q <= 4) || 50;
    for (let v = Math.ceil(y0 / passo) * passo; v <= y1; v += passo) {
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/>
        <text x="${m.l - 6}" y="${Y(v) + 4}" font-size="10.5" text-anchor="end" fill="var(--muted)">${esc(p.yFmt(v))}</text>`;
    }
    if (p.ref != null) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(p.ref)}" y2="${Y(p.ref)}" stroke="var(--ref)" stroke-dasharray="4 3"/>`;
    for (const b of p.barras || []) {
      const bh = (b.v / p.barMax) * h;
      svg += `<rect x="${X(b.x)}" y="${y + h - bh}" width="${Math.max(1.5, X(b.x + b.w) - X(b.x) - 1)}" height="${bh}" rx="1.5" fill="${b.cor}"/>`;
    }
    const rot = [];
    for (const s of p.series) {
      const pts = s.pts.filter((q) => q[0] >= x0 - 30 && q[0] <= x1);
      if (!pts.length) continue;
      let d = "";
      pts.forEach((q, i) => {
        const px = Math.max(m.l, X(q[0])).toFixed(1), py = Y(q[1]).toFixed(1);
        d += i === 0 ? `M${px},${py}` : s.degrau ? `H${px}V${py}` : `L${px},${py}`;
      });
      if (s.ate != null) d += `H${X(s.ate).toFixed(1)}`;
      svg += `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="${s.fina ? 1.5 : 2}" stroke-linejoin="round" ${s.tracejada ? 'stroke-dasharray="5 4"' : ""}/>`;
      const u = pts[pts.length - 1];
      rot.push({ y: Y(u[1]), t: `${s.nome} ${(p.rotFmt || p.yFmt)(u[1], true)}`, cor: s.cor, x: X(s.ate ?? u[0]) });
    }
    rot.sort((a, b) => a.y - b.y);
    for (let i = 1; i < rot.length; i++) if (rot[i].y - rot[i - 1].y < 13) rot[i].y = rot[i - 1].y + 13;
    for (const r of rot) svg += `<text x="${W - m.r + 6}" y="${r.y + 4}" font-size="11" font-weight="600" fill="var(--text)"><tspan fill="${r.cor}">●</tspan> ${esc(r.t)}</text>`;
    y += h + m.gap + 8;
  }
  const H = y - m.gap + 14;
  // faixas (episódios) e marcos (fechamentos) atravessam todos os painéis
  let fundo = "";
  for (const f0 of cfg.faixas || []) {
    const f = { ...f0, de: Math.max(f0.de, x0) };
    if (f.ate <= x0) continue;
    fundo += `<rect x="${X(f.de)}" y="${m.t - 4}" width="${Math.max(3, X(f.ate) - X(f.de))}" height="${H - m.t - 10}" fill="var(--text)" opacity=".07"/>
      <text x="${(X(f.de) + X(f.ate)) / 2}" y="${H - 2}" font-size="10.5" text-anchor="middle" fill="var(--text-2)" font-weight="600">${esc(f.rot)}</text>`;
  }
  let frente = "";
  const usados = [];
  for (const k of cfg.marcos || []) {
    frente += `<line x1="${X(k.x)}" x2="${X(k.x)}" y1="${m.t - 4}" y2="${H - 16}" stroke="var(--text-2)" stroke-dasharray="2 3" opacity="${k.forte ? 0.7 : 0.3}"/>`;
  }
  // rótulos: os fechamentos com mais eleitores escolhem lugar primeiro
  for (const k of (cfg.marcos || []).filter((k) => k.forte).sort((a, b) => (b.peso || 0) - (a.peso || 0))) {
    const x = X(k.x);
    if (usados.some((u) => Math.abs(u - x) < 72)) continue;
    usados.push(x);
    frente += `<text x="${x + 3}" y="${m.t + 6}" font-size="10" fill="var(--text-2)">${esc(k.rot)}</text>`;
  }
  frente += `<line x1="${X(cfg.agora)}" x2="${X(cfg.agora)}" y1="${m.t - 4}" y2="${H - 16}" stroke="var(--text)" stroke-width="1.5"/>
    <text x="${X(cfg.agora) - 4}" y="${H - 4}" font-size="10.5" text-anchor="end" fill="var(--text)" font-weight="650">agora</text>`;
  const passoX = W < 640 ? 360 : 120;
  const ticks = []; for (let t = Math.ceil(x0 / passoX) * passoX; t <= x1; t += passoX) ticks.push(t);
  const eixo = ticks.map((t) => `<text x="${X(t)}" y="${H - 16}" font-size="10.5" text-anchor="middle" fill="var(--muted)">${hhmm(t)}</text>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="Mercados ao longo do dia">${fundo}${svg}${frente}${eixo}
    <line class="cruz" y1="${m.t - 4}" y2="${H - 16}" stroke="var(--text)" opacity=".5" visibility="hidden"/>
    <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg>`;
  const sv = el.querySelector("svg"), cruz = sv.querySelector(".cruz"), tip = $("tooltip");
  sv.addEventListener("mousemove", (ev) => {
    const r = sv.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
    if (px < m.l || px > W - m.r) { tip.hidden = true; cruz.setAttribute("visibility", "hidden"); return; }
    const t = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    cruz.setAttribute("x1", px); cruz.setAttribute("x2", px); cruz.setAttribute("visibility", "visible");
    let h = `<div class="tt-n">${hhmm(t)}</div><div class="tt-g">`;
    for (const g of geo) for (const s of g.p.series) {
      if (s.semTip) continue;
      const v = ultimo(s.pts, t);
      if (v != null && (s.ate == null || t <= s.ate + 1)) h += `<span><span style="color:${s.cor}">●</span> ${esc(s.tipNome || s.nome)}</span><span>${g.p.yFmt(v, true)}</span>`;
    }
    h += "</div>";
    const perto = (cfg.marcos || []).filter((k) => Math.abs(k.x - t) <= 20 && k.tip);
    if (perto.length) h += `<div class="tt-s" style="margin:6px 0 0">${perto.map((k) => esc(k.tip)).join("<br>")}</div>`;
    tooltip(ev, h);
  });
  sv.addEventListener("mouseleave", () => { tip.hidden = true; cruz.setAttribute("visibility", "hidden"); });
}

function renderMercados(est) {
  const mk = est.mercados || {}, pm = mk.polymarket || {}, k = mk.kalshi || {}, mv = est.movimentos;
  if (!mv) { $("mk-agora").innerHTML = `<div class="vazio">Histórico dos mercados ainda não carregado.</div>`; return; }
  const S = mv.series, agora = mv.agora_min;
  const ok = brOk(), p = est.brasil?.modelos?.[MODELO];
  // ---------- agora ----------
  const delta = (s, desde) => { const a = ultimo(s, desde), b = ultimo(s, agora); return a == null || b == null ? null : b - a; };
  const marg = S.fatia.map((q) => [q[0], margemDe(q[1])]);
  const prox = mv.ondas.find((o) => !o.fechou && o.eleitorado >= 1000);
  const card = (rot, corpo, pe, cls = "") => `<div class="mk-card ${cls}"><div class="rot">${rot}</div>${corpo}<div class="pe">${pe}</div></div>`;
  const pct = (x) => (x == null ? null : 100 * x);
  // cartão "quem vence": manchete com o favorito pela média das fontes, e a barra dividida de cada fonte
  const cardVence = (rot, fontes) => {
    // manchete: só a média dos mercados; o nosso modelo aparece como linha própria
    const vs = fontes.filter((f) => f.v != null && !f.modelo), media = vs.length ? vs.reduce((s, f) => s + f.v, 0) / vs.length : null;
    const fav = favorito(media);
    const cab = fav ? `<div class="mk-fav">${marca(fav.c)}<span>${fav.empate ? "Empate" : `${fav.nome} favorito`}</span><b>${fmtP(par(fav.v, 1)[0], 1)}</b></div>
      <div class="mk-fav-sub">${vs.length > 1 ? `média de ${vs.map((f) => f.nome).join(" e ")}` : vs[0].nome}</div>` : `<div class="mk-fav"><span>Sem cotação</span></div>`;
    return card(rot, cab + fontes.map((f) => `<div class="mk-fonte"><div class="mk-fonte-cab"><span>${f.nome}</span>${f.d === undefined ? "" : fmtDelta(f.d)}</div>${barraDuelo(f.v, 1)}</div>`).join(""),
      "variação desde 00h", "vence");
  };
  const margK = margemDe(k.fatia_lula_mediana);
  $("mk-agora").innerHTML =
    cardVence("Quem vence a eleição", [
      { nome: "Polymarket", v: pct(pm.p_lula), d: delta(S.poly, 0) }, { nome: "Kalshi", v: pct(k.p_lula), d: delta(S.kalshi, 0) },
      ...(ok ? [{ nome: "Nosso modelo", v: p.prob_lula, modelo: true }] : [])]) +
    card("Diferença esperada pela Kalshi", `<div class="mk-grande">${margK == null ? "" : marca(margK >= 0 ? "l" : "f")}${fmtMargem(margK)}</div>
      <div class="mk-linha"><span>desde 00h</span>${fmtDelta(delta(marg, 0), 2)}</div><div class="mk-linha"><span>última hora</span>${fmtDelta(delta(marg, agora - 60), 2)}</div>`,
      "diferença entre os dois nos votos válidos, mediana implícita na escada") +
    cardVence("Quem vence no exterior", [
      { nome: "Polymarket", v: pct(pm.exterior_lula), d: delta(S.poly_ext, 0) }, { nome: "Kalshi", v: pct(k.exterior_lula), d: delta(S.kalshi_ext, 0) }]) +
    card("Próximo fechamento", prox ? `<div class="mk-grande">${hhmm(prox.min)}</div><div class="mk-prox">${esc(nomeOnda(prox, 4))}</div>
      <div class="mk-linha"><span>${fmtMi(prox.eleitorado)} eleitores</span><b>em ${Math.max(0, Math.round(prox.min - agora))} min</b></div>` : `<div class="mk-prox">Todas as urnas do exterior já fecharam.</div>`,
      "horário de Brasília");
  // ---------- linha do tempo ----------
  const x0 = 0, x1 = Math.max(22 * 60, agora + 30);
  const balde = 15, cont = {};
  for (let i = 0; i < mv.exterior.length; i++) {
    const q = mv.exterior[i], b = Math.floor(q.min / balde) * balde;
    cont[b] = (cont[b] || 0) + 1;
  }
  const barras = Object.entries(cont).map(([b, n]) => ({ x: +b, w: balde, v: n, cor: "var(--a3)" }));
  const extPct = mv.exterior.map((q) => [q.min, (100 * q.lula) / Math.max(1, q.lula + q.flavio)]);
  const pf = (v) => fmtP(v, 0), pf1 = (v, tip) => fmtP(v, tip ? 1 : 0);
  const nossoProb = mv.nosso.map((h) => [h.min, h.prob]), nossoMarg = mv.nosso.map((h) => [h.min, 2 * h.p50 - 100]);
  // Cada painel de chance é desenhado do ponto de vista do favorito de agora: subir = favorito mais forte.
  // O fundo mostra de que lado do empate está cada trecho, então uma virada aparece como travessia da linha de empate.
  const ult = (s) => (s.length ? s[s.length - 1][1] : null);
  const media = (...xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const lado = (pL) => (pL == null || pL >= 50 ? "l" : "f"), outro = (c) => (c === "l" ? "f" : "l");
  const painelChance = (titulo, h, fav, series, fina) => {
    const F = NOME_LADO[fav], O = NOME_LADO[outro(fav)], conv = (v) => (fav === "l" ? v : 100 - v);
    return { titulo: `${titulo}: ${F} é o favorito`, h, padMin: 2,
      lados: { ref: 50, acima: { c: fav, rot: `${F} favorito` }, abaixo: { c: outro(fav), rot: `${O} favorito` } },
      // abaixo do empate o rótulo leva o nome de quem lidera ali, para 45 e 55 não saírem iguais
      yFmt: (v, tip) => (tip ? `${F} ${fmtP(v, 1)} · ${O} ${fmtP(100 - v, 1)}` : v >= 50 ? fmtP(v, 0) : `${O} ${fmtP(100 - v, 0)}`),
      rotFmt: (v) => (v >= 50 ? fmtP(v, 1) : `${O} ${fmtP(100 - v, 1)}`),
      series: series.map((s) => ({ ...s, fina, pts: s.pts.map((q) => [q[0], conv(q[1])]) })) };
  };
  const favBR = lado(media(ult(S.poly), ult(S.kalshi))), favExt = lado(media(ult(S.poly_ext), ult(S.kalshi_ext)));
  const favM = lado(ult(marg) == null ? null : 50 + ult(marg)), convM = (v) => (favM === "l" ? v : -v);
  const FM = NOME_LADO[favM], OM = NOME_LADO[outro(favM)];
  $("mk-dia-sub").textContent = `${hhmm(x0)} a ${hhmm(x1)} · horário de Brasília`;
  linhaTempo($("mk-linha"), {
    x0, x1, agora,
    paineis: [
      painelChance("Chance de vitória", 120, favBR, [
        { nome: "Polymarket", cor: "var(--poly)", pts: S.poly, ate: agora },
        { nome: "Kalshi", cor: "var(--kalshi)", pts: S.kalshi, ate: agora },
        ...(nossoProb.length ? [{ nome: "Nosso", tipNome: "Nosso modelo", cor: "var(--text)", pts: nossoProb, tracejada: true }] : []) ]),
      { titulo: `Diferença esperada: ${FM} à frente`, sub: "nos votos válidos · Kalshi, mediana da escada", h: 100, padMin: 0.3,
        lados: { ref: 0, acima: { c: favM, rot: `${FM} à frente` }, abaixo: { c: outro(favM), rot: `${OM} à frente` } },
        yFmt: (v, tip) => (tip ? fmtMargem(convM(v), 2) : (v >= 0 ? "" : `${OM} `) + Math.abs(v).toFixed(1).replace(".", ",")),
        rotFmt: (v) => `${v >= 0 ? FM : OM} +${Math.abs(v).toFixed(2).replace(".", ",")} pp`, series: [
        { nome: "Kalshi", tipNome: "Diferença (Kalshi)", cor: "var(--kalshi)", pts: marg.map((q) => [q[0], convM(q[1])]), ate: agora, fina: true },
        ...(nossoMarg.length ? [{ nome: "Nosso", tipNome: "Diferença (nosso modelo)", cor: "var(--text)", pts: nossoMarg.map((q) => [q[0], convM(q[1])]), tracejada: true }] : []) ] },
      painelChance("Quem vence no exterior", 80, favExt, [
        { nome: "Polymarket", tipNome: "Exterior · Polymarket", cor: "var(--poly)", pts: S.poly_ext, ate: agora },
        { nome: "Kalshi", tipNome: "Exterior · Kalshi", cor: "var(--kalshi)", pts: S.kalshi_ext, ate: agora } ], true),
      { titulo: "Exterior: Lula nos boletins já contados", sub: "barras: boletins recebidos a cada 15 min", h: 90, yFmt: pf1, ref: 50, padMin: 3,
        barMax: Math.max(...barras.map((b) => b.v), 1) * 2.2, barras, series: [
        { nome: "Lula", tipNome: "Lula no exterior (acumulado)", cor: "var(--lula)", pts: extPct, degrau: true, ate: extPct.length ? agora : null } ] },
    ],
    marcos: mv.ondas.map((o) => ({ x: o.min, forte: o.eleitorado >= 10000, rot: o.paises[0], peso: o.eleitorado,
      tip: `${hhmm(o.min)} fecham ${nomeOnda(o, 4)} (${fmtMi(o.eleitorado)} eleitores)` })),
    faixas: mv.episodios.map((e, i) => ({ de: e.de, ate: e.ate, rot: String(i + 1) })),
  });
  // ---------- tabela por fechamento ----------
  const lista = mv.ondas.filter((o) => expandido.ondas || o.eleitorado >= 1000);
  const mvd = (o, chave, dec = 1) => { const v = o.mercado?.[chave]; return v && v[0] != null && v[1] != null ? fmtDelta(v[1] - v[0], dec, true) : `<span class="muted">—</span>`; };
  $("mk-ondas").innerHTML = `<thead><tr><th>Fecha</th><th>Quem</th><th>Eleitores</th><th>Boletins</th><th>Quem lidera nos boletins</th><th>× 1º turno*</th>
      <th>Chance de vencer</th><th>Diferença esperada</th><th>Quem vence no exterior</th></tr></thead><tbody>` +
    lista.map((o) => {
      const d1 = o.lula_pct != null && o.lula_1t_pct != null ? o.lula_pct - o.lula_1t_pct : null;
      const futuro = !o.fechou;
      const parcial = o.fechou && o.mercado_ate != null && o.mercado_ate < o.min + 90;
      return `<tr class="${futuro ? "futuro" : ""}"><td><b>${hhmm(o.min)}</b></td>
        <td class="quem" title="${esc(o.paises.join(", "))}">${esc(nomeOnda(o))}</td>
        <td>${fmtMi(o.eleitorado)}</td>
        <td>${futuro ? `<span class="muted">em ${Math.round(o.min - agora)} min</span>` : `${o.bus}/${o.secoes}`}</td>
        <td>${o.lula_pct == null ? `<span class="muted">—</span>` : (({ c, nome, v }) => `<span class="mk-d">${marca(c)}${nome} ${fmtP(v)}</span>`)(favorito(o.lula_pct))}</td>
        <td>${fmtDelta(d1, 1, true)}</td>
        <td>${futuro ? "" : mvd(o, "chance")}</td><td>${futuro ? "" : mvd(o, "margem", 2)}</td><td>${futuro ? "" : mvd(o, "kalshi_ext")}${parcial ? ` <span class="muted" title="Ainda não passaram 90 min">…</span>` : ""}</td></tr>`;
    }).join("") + `</tbody>`;
  const nPeq = mv.ondas.filter((o) => o.eleitorado < 1000).length;
  $("mk-ondas-mais").innerHTML = (nPeq ? `<button class="mais" data-exp="ondas">${expandido.ondas ? "Esconder os fechamentos pequenos" : `Mostrar também ${nPeq} fechamentos com menos de mil eleitores`}</button>` : "") +
    `<p class="nota-leitura" style="margin-top:8px">Variações em pontos percentuais, com o nome de quem ganhou terreno. * Boletins já chegados contra o 1º turno nas mesmas cidades (só entre Lula e Flávio). "Quem vence no exterior" é o mercado da Kalshi.</p>`;
  // ---------- episódios ----------
  const chanceTxt = (pL) => { const [l, f] = par(pL, 1); return `Lula ${fmtP(l)} × Flávio ${fmtP(f)}`; };
  $("mk-ep-sub").textContent = `quando a chance média andou ${fmtP(mv.limiar_pp, 1).replace("%", " pp")} ou mais em ${mv.janela_min} min`;
  $("mk-episodios").innerHTML = mv.episodios.length ? mv.episodios.map((e, i) => {
    const fech = e.fecharam.length ? `Fecharam por perto: <b>${esc(e.fecharam.slice(0, 4).map((f) => f.pais).join(", "))}</b> (${fmtMi(e.fecharam_eleitorado)} eleitores).` : "Nenhum fechamento do exterior por perto.";
    const bus = e.boletins ? `${e.boletins === 1 ? "Chegou 1 boletim" : `Chegaram ${e.boletins} boletins`}${e.bu_paises.length ? ` (${esc(e.bu_paises.join(", "))})` : ""}: Lula ${fmtP((100 * e.bu_lula) / Math.max(1, e.bu_lula + e.bu_flavio))}.` : "Nenhum boletim chegou nessa janela.";
    return `<div class="ep"><div class="ep-n">${i + 1}</div><div>
      <div class="ep-t">${hhmm(e.de)}–${hhmm(e.ate)} · ${fmtDelta(e.delta)}</div>
      <div class="ep-c">Chance de vitória: ${chanceTxt(e.chance_de)} → ${chanceTxt(e.chance_ate)}</div>
      <div class="ep-d">Diferença esperada: ${fmtMargem(e.margem[0], 2)} → ${fmtMargem(e.margem[1], 2)}. ${fech} ${bus}</div></div></div>`;
  }).join("") : `<div class="vazio">Nenhum movimento forte hoje até agora: o mercado andou devagar.</div>`;
  // ---------- retrato (recolhido) ----------
  if (!$("mk-detalhes").open) return;
  grafico($("mk-escada"), {
    aria: "Escada da Kalshi", xFmt: (v) => fmtP(v, 1), yMin: 0, yMax: 100, refs: [{ y: 50 }],
    vrefs: ok ? [{ x: p.lula_pct, label: "nosso modelo", solida: true, cor: "var(--text)" }] : [],
    series: [{ nome: "Kalshi", cor: "var(--kalshi)", pts: (k.escada_lula || []).map((e) => ({ x: e.limiar, y: 100 * e.prob })) }],
  });
  const margem = ok ? 2 * p.lula_pct - 100 : null;
  $("mk-margem").innerHTML = `<div class="sub-h">Margem · Kalshi</div>${baldesMargem(k.margem, margem)}<div class="sub-h">Margem · Polymarket</div>${baldesMargem(pm.margem, margem)}`;
  const comp = (pm.comparecimento || []).map((c) => `<div class="balde"><span class="rot">${esc(c.rotulo)}</span><div class="b" style="width:${100 * (c.prob || 0)}%;background:var(--poly)"></div><span class="p">${fmtP(100 * (c.prob || 0), 0)}</span></div>`).join("");
  $("mk-comp").innerHTML = `<div class="sub-h">Comparecimento · Polymarket (Kalshi: mediana ${k.comparecimento_mediana ? fmtN(k.comparecimento_mediana) : "—"} votantes; 1º turno: 78,9%)</div><div class="baldes">${comp}</div>`;
}

// ================================================================ Coleta
function renderColeta(est) {
  const s = est.saude || {};
  const idade = (ts) => (ts ? Math.round((Date.now() - new Date(ts).getTime()) / 1000) : null);
  const nomes = { vigia: "Vigia", oficial: "Totalização oficial", exterior: "Exterior (BUs)", mercados: "Mercados", cruzamento_ascaribe: "Cruzamento com ascaribe" };
  const c = est.coleta || {};
  $("cl-sub").textContent = `BUs ${c.bu_secoes}/${c.secoes_ext} · municípios lidos ${c.municipios_lidos} · bases ${Object.entries(est.bases_ok || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`;
  $("cl-saude").innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Laço</th><th>Última batida</th><th>Há</th><th style="text-align:left">Detalhe</th></tr></thead><tbody>` +
    Object.entries(nomes).filter(([k]) => s[k]).map(([k, n]) => {
      let v = s[k].valor; try { v = JSON.stringify(JSON.parse(v)); } catch {}
      const i = idade(s[k].ts);
      return `<tr><td>${n}</td><td>${hora(s[k].ts)}</td><td>${i == null ? "—" : i + " s"}</td><td style="text-align:left;white-space:normal" class="muted">${esc(v).slice(0, 240)}</td></tr>`;
    }).join("") + `</tbody></table></div>`;
  $("cl-eventos").innerHTML = (est.eventos || []).map((e) => `<li class="${e.nivel}">${e.ts.slice(11, 19)} ${esc(e.nivel)} ${esc(e.msg)}</li>`).join("");
}

// ================================================================ casca
function render(est) {
  EST = est;
  const n = est.nacional, x = est.exterior || {};
  $("andamento").innerHTML = est.fase === "apurando"
    ? `<span><b>${fmtP(n.apurado_pct, 2)}</b> apurado</span><span class="trilho"><i style="width:${n.apurado_pct}%"></i></span><span>TSE ${n.hg?.slice(0, 5) || ""}</span>`
    : `<span>Exterior <b>${fmtN(x.secoes)}/${fmtN(x.secoes_tot)}</b> seções</span><span class="trilho"><i style="width:${x.secoes_tot ? (100 * x.secoes) / x.secoes_tot : 0}%"></i></span><span>Brasil às 17h</span>`;
  let vg = {}; try { vg = JSON.parse(est.saude?.vigia?.valor || "{}"); } catch {}
  const sd = $("saude");
  sd.className = "saude" + (vg.status === "ok" ? " ok" : vg.status === "alerta" ? " alerta" : "");
  sd.title = `Atualizado ${est.agora.slice(11, 19)}\n` + ((vg.problemas || []).join("\n") || "Coleta sem problemas");
  sd.querySelector("span").textContent = vg.status === "alerta" ? "alerta" : est.agora.slice(11, 16);
  if (aba === "brasil" || aba === "exterior") {
    if (aba === "brasil") renderBrasil(est); else renderExterior(est);
    renderMapa(est);
  }
  if (aba === "mercados") renderMercados(est);
  if (aba === "coleta") renderColeta(est);
}

function irPara(a) {
  if (!["brasil", "exterior", "mercados", "coleta"].includes(a)) a = "brasil";
  aba = a;
  if (location.hash !== "#" + a) history.replaceState(null, "", "#" + a);
  document.querySelectorAll(".escopos button").forEach((b) => b.setAttribute("aria-selected", b.dataset.aba === a));
  $("aba-mapa").hidden = !(a === "brasil" || a === "exterior");
  $("aba-mercados").hidden = a !== "mercados";
  $("aba-coleta").hidden = a !== "coleta";
  $("tooltip").hidden = true;
  if (EST) render(EST);
}

function initUI() {
  document.querySelectorAll(".escopos button").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.aba)));
  window.addEventListener("hashchange", () => irPara((location.hash || "#brasil").slice(1)));
  document.addEventListener("click", (ev) => {
    const md = ev.target.closest("[data-modo]");
    if (md && !md.disabled) {
      const e = aba === "exterior" ? "exterior" : "brasil";
      modo[e] = md.dataset.modo; ls.set(e === "brasil" ? "modo-br" : "modo-ex", modo[e]);
      if (EST) render(EST);
      return;
    }
    const ps = ev.target.closest("[data-preset]");
    if (ps && SVG.mundo) {
      sel.exterior = null;
      zoomPara(SVG.mundo, boxPreset(PRESETS.find((p) => p.id === ps.dataset.preset)));
      if (EST) render(EST);
      return;
    }
    const sl = ev.target.closest("[data-sel]");
    if (sl) {
      const k = sl.dataset.sel;
      if (!k) { const e = aba === "exterior" ? "exterior" : "brasil"; selecionar(sel[e]); }
      else selecionar(k);
      if (sl.tagName === "TR") $("mapa").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const ex = ev.target.closest("[data-exp]");
    if (ex) { expandido[ex.dataset.exp] = !expandido[ex.dataset.exp]; if (EST) render(EST); }
  });
  $("metodo").addEventListener("toggle", () => { if ($("metodo").open && EST) render(EST); });
  $("mk-detalhes").addEventListener("toggle", () => { if ($("mk-detalhes").open && EST) render(EST); });
  irPara((location.hash || "#brasil").slice(1));
}

async function ciclo() {
  try {
    const r = await fetch("/api/estado", { cache: "no-store" });
    if (r.ok) render(await r.json());
  } catch (e) {
    $("andamento").textContent = "falha ao ler o servidor local";
  }
}
initUI();
if ("ResizeObserver" in window) {
  new ResizeObserver(() => { const el = $("mk-linha"); if (EST && aba === "mercados" && +el.dataset.w !== el.clientWidth) renderMercados(EST); }).observe($("mk-linha"));
}
ciclo();
setInterval(ciclo, POLL_MS);
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => EST && render(EST), 200); });
