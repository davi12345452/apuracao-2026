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

// ---------- imparcialidade: o placar é dito pelo nome de quem lidera ----------
// pL: % de Lula entre os dois (0–100); outro: o adversário naquela eleição. Candidatos na ordem do número (13, 22).
const liderTxt = (pL, d = 1, outro = "Flávio") => (pL == null || Number.isNaN(pL) ? "—"
  : Math.abs(pL - 50) < 0.5 * 10 ** -d ? `empate ${fmtP(50, d)}` : pL > 50 ? `Lula ${fmtP(pL, d)}` : `${outro} ${fmtP(100 - pL, d)}`);
const lider = (pL, d = 1, outro = "Flávio") => (pL == null || Number.isNaN(pL) ? "—" : `${marca(pL >= 50 ? "l" : "f")}${liderTxt(pL, d, outro)}`);
const duoTxt = (pL, d = 1, outro = "Flávio") => (pL == null ? "—" : `Lula ${fmtP(par(pL, d)[0], d)} × ${outro} ${fmtP(par(pL, d)[1], d)}`);
// saldo em votos (positivo = Lula) → "Lula +12 mil"
const saldoTxt = (v) => (v == null ? "—" : Math.abs(v) < 0.5 ? "0" : `${marca(v > 0 ? "l" : "f")}${v > 0 ? "Lula" : "Flávio"} +${fmtMi(Math.abs(v))}`);
// eixo de % de Lula escrito pelos dois lados: L 55 / 50% / F 55
const ladoEixo = (v, o = "F") => (Math.abs(v - 50) < 1e-9 ? "50%" : v > 50 ? `L ${+v.toFixed(1)}`.replace(".", ",") : `${o} ${+(100 - v).toFixed(1)}`.replace(".", ","));
// dicas: "?" ao lado de títulos e termos sublinhados
const ajuda = (t) => `<span class="ajuda" tabindex="0" data-tip="${esc(t)}" aria-label="${esc(t)}">?</span>`;
const comTip = (rot, t) => `<span class="tip" tabindex="0" data-tip="${esc(t)}">${rot}</span>`;
const descFaixa = (f) => (f.de === 0 ? `Flávio com mais de ${100 - f.ate}% no 1º turno` : f.ate >= 100 ? `Lula com ${f.de}% ou mais no 1º turno`
  : f.de >= 50 ? `Lula entre ${f.de}% e ${f.ate}% no 1º turno` : `Flávio entre ${100 - f.ate}% e ${100 - f.de}% no 1º turno`);
const DICA = {
  validos: "Votos válidos: só os votos dados a Lula ou a Flávio. Brancos e nulos ficam de fora.",
  terceira: "3ª via: votos que, no 1º turno, foram para candidatos que não estão no 2º turno.",
  voltam: "Eleitores que não votaram no 1º turno e votaram agora (ou o contrário, quando a abstenção sobe).",
  abstencao: "Abstenção: eleitores aptos que não foram votar.",
  faixa80: "Faixa provável: em 80% das simulações o resultado final ficou dentro dela.",
  projecao: "Estimativa do resultado final: os votos já contados mais o que se espera das urnas que faltam, lugar por lugar.",
  base: "Base: o resultado do 1º turno de cada lugar, com os votos da 3ª via divididos como estão se dividindo nas urnas já contadas.",
  pp: "pp (pontos percentuais): diferença entre duas porcentagens. De 48% para 50% são 2 pp.",
  saldo: "Saldo do que falta: vantagem em votos que as urnas ainda não contadas devem dar a um dos dois.",
  apurado: "Parte das urnas (ou do eleitorado) que já foi contada.",
  secao: "Seção: a urna onde um grupo de eleitores vota. Cada seção gera um boletim de urna (BU) com o resultado dela.",
};

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
  cenario: { rot: "Cenário do exterior", cor: corFatia, so: "brasil" },
};
function legenda(m) {
  const esc4 = (pref, rots) => rots.map((r, i) => `<span><i style="background:${COR(pref + (i + 1))}"></i>${r}</span>`);
  if (m === "andamento") {
    return `<span class="escala"><span><i style="background:${COR("vazio")}"></i>0</span>${esc4("a", ["<25%", "<50%", "<100%", "100%"]).join("")}</span><span>das urnas apuradas</span>`;
  }
  if (m === "desvio") {
    return `<span class="lado" style="color:var(--flavio)">Flávio acima</span><span class="escala">${esc4("f", ["6+", "3–6", "1–3", "0–1"]).reverse().join("")}${esc4("l", ["0–1", "1–3", "3–6", "6+"]).join("")}</span><span class="lado" style="color:var(--lula)">Lula acima</span><span>da ${comTip("base", DICA.base)}, em ${comTip("pp", DICA.pp)}</span>`;
  }
  return `<span class="lado" style="color:var(--flavio)">Flávio</span><span class="escala">${esc4("f", ["50", "55", "60", "70+"]).reverse().join("")}${esc4("l", ["50", "55", "60", "70+"]).join("")}</span><span class="lado" style="color:var(--lula)">Lula</span><span>% dos ${comTip("votos válidos", DICA.validos)} de quem lidera</span>`;
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
    const cen = EST?.brasil?.cenario?.mun?.[p.dataset.k];
    tooltip(ev, `<div class="tt-n">${esc(r[1])}</div><div class="tt-s">${r[2].toUpperCase()} · ${fmtN(r[3])} eleitores · ${fmtP(r[4], 0)} apurado</div>
      <div class="tt-g"><span>Contado</span><span>${r[4] ? liderTxt(r[5]) : "—"}</span>
      ${brOk() ? `<span>Projeção</span><span>${liderTxt(r[6])}</span><span>Diferença da base</span><span>${r[7] == null ? "—" : fmtDelta(r[7], 1, true)}</span>` : ""}
      ${cen != null ? `<span>Cenário do exterior</span><span>${liderTxt(cen)}</span>` : ""}
      <span>1º turno 2026*</span><span>${liderTxt(r[8])}</span></div>
      <div class="tt-s" style="margin:6px 0 0">* só os votos dos dois</div>`);
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; ultimo?.classList.remove("on"); ultimo = null; });
  svg.addEventListener("click", (ev) => {
    const p = ev.target.closest(".m"); if (!p) return;
    const r = MUN[p.dataset.k]; if (r && r[2]) selecionar(r[2]);
  });
  return svg;
}

let MUN = {}, FIX = null;
async function garantirFix() {
  if (FIX) return;
  try {
    const r = await fetch("/api/municipios");
    const l = r.ok ? await r.json() : [];
    if (l.length) { FIX = {}; for (const x of l) FIX[x[0]] = x; }
  } catch {}
}
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
    const v = m === "cenario" ? EST?.brasil?.cenario?.mun?.[p.dataset.k] ?? null : r ? r[col] : null;
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
      <div class="tt-g"><span>Contado</span><span>${r.secoes ? liderTxt(r.lula_pct) : "—"}</span>
      ${r.proj ? `<span>Projeção</span><span>${liderTxt(r.proj.lula_final_pct)}</span>` : ""}
      <span>1º turno 2026*</span><span>${liderTxt(r.lula_1t_final_2v_pct)}</span>
      <span>2º turno 2022</span><span>${liderTxt(r.lula_2022_pct, 1, "Bolsonaro")}</span></div>
      <div class="tt-s" style="margin:6px 0 0">* só os votos dos dois</div>`);
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
    <div class="faixa" style="left:${p.p10}%;width:${Math.max(0.6, p.p90 - p.p10)}%" data-tip="${esc(DICA.faixa80)}"></div><div class="meio"></div></div>`;
}
function blocoChances(nosso, pm, k, sub) {
  // disputa binária: barra dividida Lula | Flávio e, à direita, quem é o favorito e com quanto
  const linha = (q, v, cls, dica) => {
    const f = favorito(v);
    return `<div class="chance ${cls}"><span class="q">${comTip(q, dica)}</span>
    ${v == null ? `<div class="t nada"></div>` : `<div class="t" data-tip="Chance de vitória: ${esc(duoTxt(v, 0))}"><div class="bl" style="width:${v}%"></div><div class="bf"></div></div>`}
    <span class="v">${f ? `${marca(f.c)}${f.nome} ${fmtP(par(f.v, 1)[0], 1)}` : "—"}</span></div>`;
  };
  return `<h3>Quem vence<span>${sub}</span></h3>
    <div class="chance chance-cab"><span></span><span class="lados"><span>${marca("l")}Lula</span><span>Flávio${marca("f")}</span></span><span class="v">favorito</span></div>
    ${linha("Este painel", nosso, "nosso", "Chance calculada por este painel: simula milhares de vezes o resultado final a partir dos votos já contados. Só aparece com voto suficiente apurado.")}
    ${linha("Polymarket", pm == null ? null : 100 * pm, "", "Preço do contrato no mercado de previsão Polymarket, lido como chance de vitória. Reflete as apostas, não pesquisa.")}
    ${linha("Kalshi", k == null ? null : 100 * k, "", "Preço do contrato no mercado de previsão Kalshi, lido como chance de vitória. Reflete as apostas, não pesquisa.")}`;
}

// ================================================================ faixa do veredito (topo de Brasil e Exterior)
const kpi = (rot, v, sub, dica) => `<div class="hk"><span class="k">${dica ? comTip(rot, dica) : rot}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
function hero(escopo, est, p, alt, cas) {
  const br = escopo === "brasil", x = (br ? est.brasil : est.exterior) || {};
  const ok = br ? brOk() : !!(p && p.lula_pct != null && p.disponivel);
  const r = x.ref_final || {}, r22 = r["2022_2t"] || {}, r1 = r["2026_1t"] || {};
  const dCont = `Votos já contados, só entre os dois candidatos. ${DICA.validos}`;
  let cont;
  if (br) {
    const n = est.nacional || {};
    cont = est.fase === "apurando" && n.validos ? kpi("Contado agora", lider((100 * n.lula) / n.validos), `${fmtP(n.apurado_pct, 1)} das urnas · TSE ${esc(n.hg?.slice(0, 5) || "")}`, dCont)
      : kpi("Contado agora", "—", "o TSE começa a divulgar às 17h", dCont);
  } else {
    const mu = x.mesmas_urnas || {};
    cont = kpi("Contado agora", mu.validos ? lider((100 * mu.lula) / mu.validos) : "—", `${fmtN(x.secoes)} de ${fmtN(x.secoes_tot)} seções · último às ${hora(x.ultimo_bu)}`, dCont);
  }
  const dif = ok && r22.lula_pct != null ? p.lula_pct - r22.lula_pct : null;
  const k22 = kpi("2º turno 2022", lider(r22.lula_pct, 1, "Bolsonaro"), dif == null ? "resultado final" : `projeção de hoje: ${fmtDelta(dif, 1, true)} pp`,
    "Resultado final do 2º turno de 2022, Lula × Bolsonaro, em votos válidos. Abaixo, quanto a projeção de hoje se afasta dele.");
  const k1 = kpi("1º turno 2026", lider(r1.lula_pct), "só os votos dos dois", "Resultado do 1º turno de 2026 contando só os votos de Lula e de Flávio. É o ponto de partida da projeção.");
  const cr = x.crescimento;
  const kab = !br && cr ? kpi("Abstenção", fmtP(cr.abst, 1), `${fmtP(cr.abst_1t, 1)} no 1º turno, mesmas seções`, DICA.abstencao)
    : ok && p.abstencao_final_pct != null ? kpi("Abstenção projetada", fmtP(p.abstencao_final_pct, 1), `${fmtP(r1.abstencao_pct, 1)} no 1º turno`, DICA.abstencao)
    : kpi("Abstenção no 1º turno", fmtP(r1.abstencao_pct, 1), `2º turno 2022: ${fmtP(r22.abstencao_pct, 1)}`, DICA.abstencao);
  const kpis = `<div class="h-kpis">${cont}${k22}${k1}${kab}</div>`;
  const rot = comTip(br ? "Projeção do resultado" : "Projeção do exterior", DICA.projecao);
  if (!ok) {
    const ap = p ? 100 * p.apurado_eleitorado : 0;
    const t = br && est.fase !== "apurando" ? "A apuração começa às 17h" : `Aguardando ${br ? 5 : 2}% apurado`;
    const sub = br && est.fase !== "apurando"
      ? `Até lá, só o exterior tem votos, contados boletim a boletim na aba <a href="#exterior">Exterior</a>. O mapa mostra o 1º turno.`
      : `Apurado até agora: ${fmtP(ap)} do eleitorado. Com tão pouco voto, a projeção ainda não é confiável.`;
    return `<div class="h-ver"><div class="rot">${rot}</div><div class="frase">${t}</div><p class="h-nota">${sub}</p></div>${kpis}`;
  }
  const f = frase(p), fv = favorito(p.prob_lula), lado = p.margem_votos >= 0 ? "Lula" : "Flávio";
  return `<div class="h-ver"><div class="rot">${rot} · ${fmtP(100 * p.apurado_eleitorado, 0)} apurado</div>
      <div class="frase ${f.c}">${f.t}</div>
      <p class="h-nota">${fv.empate ? "chances iguais" : `chance de vitória de ${fv.nome}: <b>${fmtP(fv.v, 0)}</b>`} · ${lado} à frente por <b>${fmtMi(Math.abs(p.margem_votos))}</b> votos</p></div>
    <div class="h-duelo"><div class="duelo"><div class="lado"><span class="nome">Lula · 13</span><span class="pct l">${fmtP(p.lula_pct)}</span></div>
      <div class="lado dir"><span class="nome">Flávio · 22</span><span class="pct f">${fmtP(100 - p.lula_pct)}</span></div></div>
      ${barraProj(p)}
      <div class="det"><span>${comTip("faixa provável", DICA.faixa80)}: <b>${liderTxt(p.p10)} a ${liderTxt(p.p90)}</b></span>${alt?.lula_pct != null ? `<span>${comTip("outra base", "A mesma conta partindo do 2º turno de 2022 em vez do 1º turno de 2026. Serve de conferência.")}: ${liderTxt(alt.lula_pct)}</span>` : ""}</div></div>
    ${kpis}
    ${cas ? `<p class="h-porque">${frasePorque(cas)}</p>` : ""}`;
}

// ================================================================ lateral: ao vivo (resumo; o completo fica em "Tudo o que entrou")
function aoVivoExterior(est) {
  const x = est.exterior || {}, rec = x.recentes || [], L = (x.lotes || [])[0], uh = x.placar?.ultima_hora;
  if (!rec.length) return `<h3>Ao vivo</h3><p class="dica">Nenhum boletim do exterior chegou ainda.</p>`;
  const novo = feedNovos(rec);
  const v1 = L?.vs_1t;
  const lote = L ? `<div class="av-lote"><span class="k">${hora(L.de)}–${hora(L.ate)} · ${L.boletins} ${L.boletins === 1 ? "boletim" : "boletins"} · ${esc(listaPaises(L.paises, 2))}</span>
      <span>${lider(L.lula_pct)}${v1 && L.secao_1t ? ` · ${comTip("desde o 1º turno", "Votos que cada um ganhou ou perdeu nessas mesmas seções desde o 1º turno.")}: ${marca("l")}<b>${sinalN(v1.lula - v1.lula_antes)}</b> ${marca("f")}<b>${sinalN(v1.flavio - v1.flavio_antes)}</b>` : ""}</span></div>` : "";
  // boletins seguidos da mesma cidade no mesmo minuto viram uma linha só
  const grupos = [];
  for (const r of rec) {
    const g = grupos[grupos.length - 1];
    if (g && g.cidade === r.cidade && hora(g.t) === hora(r.t)) g.rs.push(r);
    else { if (grupos.length >= 7) break; grupos.push({ cidade: r.cidade, pais: r.pais, t: r.t, rs: [r] }); }
  }
  const itens = grupos.map((g) => {
    const soma = (f) => g.rs.reduce((a, r) => a + f(r), 0);
    const L = soma((r) => r.lula), F = soma((r) => r.flavio), pl = L + F ? (100 * L) / (L + F) : null;
    const com = g.rs.filter((r) => r.v_1t), ap = com.some((r) => r.ref_1t === "cidade") ? "≈" : "";
    const dL = com.reduce((a, r) => a + r.lula - r.v_1t.lula, 0), dF = com.reduce((a, r) => a + r.flavio - r.v_1t.flavio, 0);
    const n = g.rs.length;
    return `<div class="av-i ${g.rs.some(novo) ? "novo" : ""}"><span class="h">${hora(g.t)}</span>
      <span class="o"><b>${esc(g.cidade)}</b><small>${esc(g.pais)} · ${n === 1 ? `seção ${+g.rs[0].secao}` : `${n} seções`}</small></span>
      <span class="d"><b class="${pl >= 50 ? "l" : "f"}" data-tip="${esc(`${fmtN(L)} votos para Lula e ${fmtN(F)} para Flávio`)}">${liderTxt(pl, 0)}</b>${com.length ? `<small data-tip="${esc(`Votos que Lula (L) e Flávio (F) ganharam ou perderam nas mesmas seções desde o 1º turno${ap ? ". ≈: seção nova, comparada com a média da cidade" : ""}.`)}">L ${ap}${sinalN(dL)} · F ${ap}${sinalN(dF)}</small>` : ""}</span></div>`;
  }).join("");
  return `<h3>Ao vivo<span>último boletim às ${hora(x.ultimo_bu)}</span></h3>
    ${uh && uh.secoes ? `<p class="av-uh">Na última hora: <b>+${fmtN(uh.secoes)}</b> seções · Lula +${fmtN(uh.lula)} · Flávio +${fmtN(uh.flavio)}</p>` : ""}
    ${lote}<div class="av-lista">${itens}</div>
    <p class="dica">L e F: votos que Lula e Flávio ganharam ou perderam na mesma seção desde o 1º turno.</p>
    <button class="av-mais" data-rolar="feed-painel">Ver tudo o que entrou ↓</button>`;
}
function aoVivoBrasil(est) {
  const a = est.brasil?.analise;
  if (est.fase !== "apurando" || !a) return `<h3>Ao vivo</h3><p class="dica">Começa às 17h. Cada atualização do TSE aparece aqui, município a município, comparada com o 1º turno.</p>`;
  const lt = (a.lotes || [])[0], ents = a.entradas || [];
  if (!lt || !ents.length) return `<h3>Ao vivo</h3><p class="dica">Aguardando a primeira atualização com votos por município.</p>`;
  const t = lt.total;
  const itens = ents.slice(0, 7).map((e) => {
    const d = e.dif_1t?.lula_pp;
    return `<div class="av-i"><span class="h">${esc((e.hg || "").slice(0, 5))}</span>
      <span class="o"><b>${esc(e.nome)}</b><small>${e.uf.toUpperCase()} · ${fmtN(e.secoes)} seções</small></span>
      <span class="d"><b class="${e.lula_pct >= 50 ? "l" : "f"}">${liderTxt(e.lula_pct, 0)}</b>${d == null ? "" : `<small>${fmtDelta(d, 1, true)} vs 1º t.</small>`}</span></div>`;
  }).join("");
  return `<h3>Ao vivo<span>TSE ${esc(lt.hg || "")}</span></h3>
    <div class="av-lote"><span class="k">Último lote · ${fmtN(t.municipios)} municípios · ${fmtMi(t.validos)} válidos</span>
      <span>${lider(t.lula_pct)} · ${fmtDelta(t.dif_pp, 1, true)} ${comTip("vs esperado", "Diferença entre o resultado do lote e o esperado para esses mesmos municípios pelo 1º turno, já com a divisão da 3ª via.")}</span></div>
    <div class="av-lista">${itens}</div>
    <p class="dica">vs 1º t.: quem ganhou terreno no município em relação ao 1º turno, em pontos percentuais.</p>
    <button class="av-mais" data-rolar="feed-painel">Ver tudo o que entrou ↓</button>`;
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
  let h = `<div class="cascata"><span class="r forte">Contado agora</span>${barraCheia(c.s0)}<span class="v forte">${liderTxt(c.s0)}</span>`;
  for (const g of c.passos) {
    const a = Math.min(g.de, g.ate), b = Math.max(g.de, g.ate), d = g.ate - g.de;
    h += `<span class="r" data-tip="${esc(g.nome)}: ${fmtMi(g.V)} votos válidos ainda por contar">+ ${esc(g.nome)}</span>
      <div class="pista">${cinq}<div class="b" style="left:${X(a)}%;width:max(2px,${X(b) - X(a)}%);background:${d >= 0 ? "var(--lula)" : "var(--flavio)"}"></div></div>
      <span class="v">${fmtDelta(d, 2, true)}</span>`;
  }
  h += `<span class="r forte">Projeção</span>${barraCheia(c.fim)}<span class="v forte">${liderTxt(c.fim)}</span>`;
  // nas pontas o rótulo encosta na borda; perto do empate (< 30% da largura) ele sai para não encavalar
  const ticks = [lo, 50, hi].filter((t, i, a) => a.indexOf(t) === i && (t === 50 || Math.abs(X(t) - X(50)) >= 30));
  const ancora = (t) => (t === lo ? "translateX(0)" : t === hi ? "translateX(-100%)" : "translateX(-50%)");
  h += `<span></span><div class="eixo">${ticks.map((t) => `<span style="left:${X(t)}%;transform:${ancora(t)}">${t === 50 ? "empate" : liderTxt(t, 0)}</span>`).join("")}</div><span></span></div>`;
  return h;
}
function frasePorque(c) {
  if (!c || c.s0 == null || !c.passos.length) return "";
  const d = c.fim - c.s0;
  if (Math.abs(d) < 0.3) return "O contado já está perto da projeção: o que falta deve votar parecido com o que já entrou.";
  const dom = c.passos.filter((g) => !g.resto && Math.sign(g.ate - g.de) === Math.sign(d)).sort((a, b) => Math.abs(b.ate - b.de) - Math.abs(a.ate - a.de))[0];
  return `Faltam <b>${fmtMi(c.falta)}</b> de votos válidos, e eles devem favorecer <b>${d > 0 ? "Lula" : "Flávio"}</b>: de ${liderTxt(c.s0)} no contado para <b>${liderTxt(c.fim)}</b> no fim.${dom ? ` O que mais pesa: <b>${esc(dom.nome)}</b>.` : ""}`;
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
  const passo = [1, 2, 5, 10, 20, 25].find((p) => (y1 - y0) / p <= 6) || Math.max(25, (y1 - y0) / 6);
  const ticks = []; for (let v = Math.ceil(y0 / passo) * passo; v <= y1; v += passo) ticks.push(v);
  const yFmt = cfg.yFmt || ((v) => String(v).replace(".", ",") + "%"), tFmt = cfg.tipFmt || yFmt;
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
    rotulos.push({ x: X(u.x), y: Y(u.y), t: `${s.nome}: ${tFmt(+u.y.toFixed(1))}` });
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
  el.innerHTML = svg + `<div class="leg-graf">${series.map((s) => `<span style="--c:${s.cor}">${esc(s.nome)}</span>${s.banda ? `<span class="faixa" style="--c:${s.cor}">faixa provável</span>` : ""}`).join("")}</div>`;
  const sv = el.querySelector("svg"), cruz = sv.querySelector(".cruz"), tip = $("tooltip");
  sv.addEventListener("mousemove", (ev) => {
    const r = sv.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W;
    const base = comDados[0].pts;
    let bi = 0; for (let i = 1; i < base.length; i++) if (Math.abs(X(base[i].x) - px) < Math.abs(X(base[bi].x) - px)) bi = i;
    const xv = base[bi].x; cruz.setAttribute("x1", X(xv)); cruz.setAttribute("x2", X(xv)); cruz.setAttribute("visibility", "visible");
    const linhas = series.map((s) => {
      let j = 0; for (let i = 1; i < s.pts.length; i++) if (Math.abs(s.pts[i].x - xv) < Math.abs(s.pts[j].x - xv)) j = i;
      const p = s.pts[j];
      return `<div><span style="color:${s.cor}">●</span> ${esc(s.nome)} <b>${tFmt(+p.y.toFixed(2))}</b>${p.lo != null ? ` <span class="muted">(faixa: ${tFmt(+p.lo.toFixed(1))} a ${tFmt(+p.hi.toFixed(1))})</span>` : ""}</div>`;
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
  return `<span class="fx-chip" data-tip="${esc(titulo)}"><small>${rot}</small><span class="v">${corpo}</span></span>`;
}
// votos de cada um contra a referência: os dois podem crescer (a 3ª via do 1º turno se redistribui)
const sinalN = (d) => (d > 0 ? "+" : d < 0 ? "−" : "±") + fmtN(Math.abs(d));
function chipVotos(rot, v, r, aprox, titulo) {
  if (!v) return `<span class="fx-chip fx-votos" data-tip="${esc(titulo)}"><small>${rot}</small><span class="v"><span class="muted">sem base</span></span></span>`;
  const ap = aprox ? "≈" : "";
  const lin = (k, nome, atual, antes) => `<span class="fx-vl">${marca(k)}<span class="n">${nome}</span><b class="${atual > antes ? "sobe" : atual < antes ? "desce" : ""}">${sinalN(atual - antes)}</b><small>de ${ap}${fmtN(antes)}</small></span>`;
  return `<span class="fx-chip fx-votos" data-tip="${esc(titulo)}"><small>${rot}</small>
    ${lin("l", "Lula", r.lula, v.lula)}${lin("f", "Flávio", r.flavio, v.flavio)}
    ${v.outros ? `<span class="fx-3v">3ª via tinha ${ap}${fmtN(v.outros)}</span>` : ""}</span>`;
}
const fmtPPs = (d) => (d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(1).replace(".", ","));
const listaPaises = (ps, n = 3) => {
  const nomes = ps.slice(0, n).map((p) => p[0]);
  const txt = nomes.length > 1 ? nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1] : nomes[0] || "";
  return txt + (ps.length > n ? ` +${ps.length - n}` : "");
};
function renderFeedExterior(est) {
  const x = est.exterior || {}, rec = x.recentes || [], lotes = x.lotes || [];
  $("feed-titulo").textContent = "Tudo o que entrou";
  $("feed-sub").textContent = "boletins na ordem em que chegaram ao TSE · horário de Brasília";
  if (!rec.length) { $("feed").innerHTML = `<div class="vazio">Nenhum boletim do exterior ainda.</div>`; return; }
  const novo = feedNovos(rec);
  const nNovos = rec.filter(novo).length;
  // ---------- resumo do último lote ----------
  const L = lotes[0];
  const minAtras = L ? Math.round((tms(est.agora) - tms(L.ate)) / 60000) : null;
  const quando = L ? (minAtras <= 0 ? "Últimos 10 min" : `${hora(L.de)}–${hora(L.ate)} (há ${minAtras} min)`) : "";
  const ref1 = L && L.secao_1t === L.boletins ? "nessas seções" : L && L.secao_1t ? "nessas seções e cidades" : "nessas cidades";
  const resumo = L ? `<div class="fx-resumo"><b>${quando}:</b> ${L.boletins} ${L.boletins === 1 ? "boletim" : "boletins"} de ${esc(listaPaises(L.paises))}
    <span class="sep">·</span> <b>${duoTxt(L.lula_pct)}</b> <span class="muted">(1º turno ${ref1}: ${liderTxt(L.lula_1t_pct)})</span>
    ${L.vs_1t && L.secao_1t ? `<span class="sep">·</span> <b>desde o 1º turno${L.secao_1t < L.boletins ? ` (${L.secao_1t} seções)` : ""}: Lula ${sinalN(L.vs_1t.lula - L.vs_1t.lula_antes)}, Flávio ${sinalN(L.vs_1t.flavio - L.vs_1t.flavio_antes)}</b> <span class="muted">(3ª via tinha ${fmtN(L.vs_1t.outros_antes)})</span>` : ""}
    <span class="sep">·</span> ${comTip("abstenção", DICA.abstencao)} <b>${fmtP(L.abstencao_pct, 0)}</b> <span class="muted">(1º turno: ${fmtP(L.abstencao_1t_pct, 0)})</span>
    ${nNovos ? `<span class="fx-novos">${nNovos} ${nNovos === 1 ? "novo" : "novos"} desde a última atualização</span>` : ""}</div>` : "";
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
        ${chipVotos(`votos × 1º turno${cid1 ? " · média da cidade" : ""}`, r.v_1t, r, cid1, `Votos nesta seção agora × no 1º turno (${cid1 ? "seção sem boletim no 1º turno: média da cidade com o mesmo número de votantes" : "mesma seção"}). Placar agora: ${liderTxt(pl)}; no 1º turno: ${liderTxt(r.lula_1t_pct)}. Abstenção: ${fmtP(r.abstencao_pct)} × ${fmtP(r.abstencao_1t_pct)}.`)}
        ${chipVotos(`votos × 2022${cid22 ? " · média da cidade" : ""}`, r.v_2022, r, cid22, `2º turno de 2022, Lula × Bolsonaro (${cid22 ? "seção não existia em 2022: média da cidade com o mesmo número de votantes" : "mesma seção"}): ${liderTxt(r.lula_2022_pct, 1, "Bolsonaro")}. Abstenção em 2022: ${fmtP(r.abstencao_2022_pct)}. Na linha de Flávio, a referência é o voto de Bolsonaro.`)}
      </span></div>`;
  }).join("");
  const maisBU = rec.length > N_BU ? `<button class="mais" data-exp="fx-bu">${expandido["fx-bu"] ? "Ver só os 10 mais recentes" : `Ver mais (${rec.length} mais recentes)`}</button>` : "";
  // ---------- lotes ----------
  const lotesVis = expandido["fx-lotes"] ? lotes : lotes.slice(0, N_LOTES);
  const maisLotes = lotes.length > N_LOTES ? `<button class="mais" data-exp="fx-lotes">${expandido["fx-lotes"] ? "Ver menos" : `Ver mais (${lotes.length})`}</button>` : "";
  const tabLotes = `<table class="tabela fx-lotes"><thead><tr><th>Chegada</th><th>Bol.</th><th>Lula</th><th>Flávio</th><th>3ª via</th></tr></thead><tbody>` +
    lotesVis.map((l) => `<tr><td><b>${hora(l.de)}</b><small>${esc(listaPaises(l.paises, 2))}</small></td><td>${l.boletins}</td>
      ${l.secao_1t ? `<td class="${l.vs_1t.lula > l.vs_1t.lula_antes ? "sobe" : "desce"}"><b>${sinalN(l.vs_1t.lula - l.vs_1t.lula_antes)}</b><small>${fmtN(l.vs_1t.lula)} votos</small></td>
      <td class="${l.vs_1t.flavio > l.vs_1t.flavio_antes ? "sobe" : "desce"}"><b>${sinalN(l.vs_1t.flavio - l.vs_1t.flavio_antes)}</b><small>${fmtN(l.vs_1t.flavio)} votos</small></td>
      <td><b>${fmtN(l.vs_1t.outros_antes)}</b><small>no 1º t.</small></td>` : `<td colspan="3" class="muted">seções novas, sem 1º turno</td>`}</tr>`).join("") + `</tbody></table>`;
  $("feed").innerHTML = `${resumo}<div class="fx-grade"><div><div class="fx-lista">${linhas}</div>${maisBU}</div>
    <div class="fx-lado"><div class="sub-h">Chegadas a cada 10 min · votos ganhos desde o 1º turno ${ajuda("Soma dos boletins que chegaram em cada intervalo de 10 minutos. Lula e Flávio: votos ganhos ou perdidos nas mesmas seções desde o 1º turno. 3ª via: votos que os outros candidatos tinham nessas seções no 1º turno.")}</div><div class="fx-tab">${tabLotes}</div>${maisLotes}
    <p class="nota-leitura">Votos ganhos ou perdidos por cada um na mesma seção. Os dois podem crescer ao mesmo tempo, porque no 2º turno os votos da 3ª via e de quem não tinha votado se dividem entre eles. "Média da cidade" e o sinal ≈ aparecem só quando a seção não existia na outra eleição.</p></div></div>`;
}

// por que cada um cresceu desde o 1º turno: 3ª via × quem passou a votar, e onde a abstenção caiu
// números grandes (Brasil) em mil/mi para caber nas colunas
const fmtC = (x) => (Math.abs(x) >= 1e5 ? fmtMi(x) : fmtN(x));
const sinalC = (d) => (d > 0 ? "+" : d < 0 ? "−" : "±") + fmtC(Math.abs(d));
function cartaoCrescimento(c, pl) {
  if (!c || !c.candidatos) return "";
  const L = c.candidatos.lula, F = c.candidatos.flavio, D = c.d_comparecimento, v22 = pl?.vs_2022;
  const voltou = D >= 0 ? "de quem não tinha votado no 1º turno" : "de quem votou no 1º turno e não voltou";
  const escala = Math.max(1, ...[L, F].map((x) => Math.max(0, x.da_3via) + Math.max(0, x.do_comparecimento)));
  const linha = (nome, lado, x) => `<div class="cr-l">
      <span class="cr-n">${marca(lado)}${nome}</span><b class="cr-g">${sinalC(x.ganho)}</b>
      <div class="cr-barra">
        <i class="s ${lado}" style="width:${(100 * Math.max(0, x.da_3via)) / escala}%" data-tip="da 3ª via: ~${fmtC(x.da_3via)}"></i>
        <i class="r ${lado}" style="width:${(100 * Math.max(0, x.do_comparecimento)) / escala}%" data-tip="${voltou}: ~${fmtC(x.do_comparecimento)}"></i>
      </div>
      <span class="cr-p"><b>~${fmtC(x.da_3via)}</b> da 3ª via · <b>~${fmtC(x.do_comparecimento)}</b> ${D >= 0 ? "de quem voltou a votar" : "de quem deixou de votar"}</span>
    </div>`;
  const pp = (a, b) => (a == null || b == null ? null : a - b);
  const saldoAbst = L.do_comparecimento - F.do_comparecimento, saldo3 = L.da_3via - F.da_3via;
  const quem = (v) => (v >= 0 ? "Lula" : "Flávio");
  const fonte = (x) => (x.do_comparecimento > x.da_3via ? "com quem não tinha votado no 1º turno" : "com a 3ª via");
  const frase = `<b>Lula</b> cresceu mais ${fonte(L)}; <b>Flávio</b>, ${fonte(F)}.
    Dos eleitores que ${D >= 0 ? "passaram a votar" : "deixaram de votar"}, cerca de <b>${fmtP(L.fatia_novos, 0)}</b> ${D >= 0 ? "foram para" : "eram de"} Lula e <b>${fmtP(F.fatia_novos, 0)}</b> ${D >= 0 ? "para" : "de"} Flávio.
    Da 3ª via, cerca de <b>${fmtP(L.fatia_3via, 0)}</b> foi para Lula e <b>${fmtP(F.fatia_3via, 0)}</b> para Flávio.
    No saldo, a mudança na abstenção deu <b>${quem(saldoAbst)} +${fmtC(Math.abs(saldoAbst))}</b> votos de vantagem e a 3ª via deu <b>${quem(saldo3)} +${fmtC(Math.abs(saldo3))}</b>.`;
  // onde a abstenção caiu
  const gs = c.grupos || [];
  const vals = gs.flatMap((g) => [g.abst_1t, g.abst]).filter((v) => v != null);
  const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1), xp = (v) => (100 * (v - lo)) / (hi - lo);
  const halter = (a, b) => `<div class="cr-halter"><span class="ln" style="left:${Math.min(xp(a), xp(b))}%;width:${Math.abs(xp(a) - xp(b))}%"></span>
      <i class="d0" style="left:${xp(a)}%" data-tip="1º turno ${fmtP(a)}"></i><i class="d1" style="left:${xp(b)}%" data-tip="agora ${fmtP(b)}"></i></div>`;
  const linhasG = gs.map((g) => `<tr><td><b>${marca(g.lado)}${g.nome}</b><small>${descFaixa(g)} · ${fmtN(g.unidades)} ${c.unidade}</small></td>
      <td class="cr-ab">${halter(g.abst_1t, g.abst)}<small>${fmtP(g.abst_1t, 1)} → <b>${fmtP(g.abst, 1)}</b></small></td>
      <td><b>${fmtPPs(pp(g.abst, g.abst_1t))} pp</b><small>abstenção</small></td>
      <td><b>${sinalC(g.d_comparecimento)}</b><small>votantes</small></td>
      <td><b>${sinalC(g.lula)}</b><small>Lula</small></td><td><b>${sinalC(g.flavio)}</b><small>Flávio</small></td></tr>`).join("");
  const gL = gs.filter((g) => g.lado === "l").slice(-1)[0], gF = gs.filter((g) => g.lado === "f")[0];
  const fraseG = gL && gF ? (() => {
    const qL = -pp(gL.abst, gL.abst_1t), qF = -pp(gF.abst, gF.abst_1t);
    const lado = qL > qF + 0.5 ? "Lula" : qF > qL + 0.5 ? "Flávio" : null;
    return `A abstenção ${qL >= 0 ? "caiu" : "subiu"} <b>${fmtP(Math.abs(qL), 1).replace("%", "")} pp</b> onde Lula era forte e ${qF >= 0 ? "caiu" : "subiu"} <b>${fmtP(Math.abs(qF), 1).replace("%", "")} pp</b> onde Flávio era forte. `
      + (lado ? `A mobilização foi maior nos redutos de ${lado}, o que ajudou <b>${lado}</b>.` : "A mobilização foi parecida nos dois lados.");
  })() : "";
  // países que mais mudaram de comparecimento
  const ps = (c.lugares || []).slice(0, 8);
  const linhasP = ps.map((x) => {
    const lado = x.lula_1t_pct >= 50 ? "l" : "f";
    return `<tr><td><b>${marca(lado)}${esc(x.lugar)}</b><small>${fmtN(x.unidades)} ${c.unidade} · 1º turno: ${liderTxt(x.lula_1t_pct, 0)}</small></td>
      <td>${fmtP(x.abst_1t, 1)} → <b>${fmtP(x.abst, 1)}</b><small>${fmtPPs(x.abst - x.abst_1t)} pp</small></td><td><b>${sinalC(x.d_comparecimento)}</b><small class="so-cel">votantes</small></td>
      <td><b>${sinalC(x.lula)}</b><small class="so-cel">Lula</small></td><td><b>${sinalC(x.flavio)}</b><small class="so-cel">Flávio</small></td></tr>`;
  }).join("");
  return `<div class="xp-card cr">
    <div class="rot">Por que cada um cresceu desde o 1º turno ${ajuda("Compara cada lugar com ele mesmo no 1º turno e separa o crescimento de cada candidato em duas fontes: votos que eram da 3ª via e votos de quem passou a votar (ou deixou de votar).")}</div>
    <div class="xp-sub">${c.unidade === "seções" ? `${fmtN(c.unidades)} seções que existem nos dois turnos` : `${fmtN(c.unidades)} municípios com ${fmtP(100 * c.min_frac, 0)} ou mais apurado (${fmtP(c.eleitorado_pct, 0)} do eleitorado), contra o 1º turno nas mesmas urnas`} · abstenção ${fmtP(c.abst_1t, 1)} → <b>${fmtP(c.abst, 1)}</b> · ${sinalC(D)} votantes · a 3ª via tinha ${fmtC(c.outros_1t)} votos</div>
    ${v22 && v22.secoes ? `<div class="xp-sub">Contra o 2º turno de 2022, nas ${fmtN(v22.secoes)} seções que já existiam: Lula <b>${sinalC(v22.lula - v22.lula_antes)}</b>, Flávio <b>${sinalC(v22.flavio - v22.flavio_antes)}</b> em relação a Bolsonaro, comparecimento <b>${sinalC(v22.comparecimento - v22.comparecimento_antes)}</b>.</div>` : ""}
    <div class="cr-grade">
      <div>
        ${linha("Lula", "l", L)}${linha("Flávio", "f", F)}
        <div class="cr-leg"><span><i class="s"></i>${comTip("da 3ª via", DICA.terceira)} do 1º turno</span><span><i class="r"></i>${comTip(voltou, DICA.voltam)}</span></div>
        <p class="fl-frase">${frase}</p>
      </div>
      <div>
        <div class="sub-h">Onde a abstenção mudou: no reduto de quem? ${ajuda("Os lugares são agrupados pelo resultado do 1º turno. Se a abstenção cai mais nos redutos de um candidato, ele ganha votos de vantagem.")}</div>
        <table class="tabela cr-tab"><tbody>${linhasG}</tbody></table>
        <div class="cr-leg"><span><i class="d0"></i>1º turno</span><span><i class="d1"></i>agora</span></div>
        <p class="fl-frase">${fraseG}</p>
      </div>
    </div>
    ${linhasP ? `<details class="cr-paises"><summary>Por ${c.tipo_lugar}: onde o comparecimento mais mudou</summary>
      <table class="tabela"><thead><tr><th>${c.tipo_lugar === "país" ? "País" : "Estado"} (cor: quem venceu ali no 1º turno)</th><th>Abstenção</th><th>Votantes</th><th>Lula</th><th>Flávio</th></tr></thead><tbody>${linhasP}</tbody></table></details>` : ""}
    <p class="xp-sub">Estimativa feita comparando ${c.unidade === "seções" ? "as seções" : "os municípios"} entre si: onde havia mais 3ª via, ou onde mais gente voltou a votar, quanto cada um cresceu. O voto de cada eleitor é secreto; isto é o padrão do conjunto. Faixa provável: da 3ª via, Lula ${fmtP(L.fatia_3via_faixa[0], 0)}–${fmtP(L.fatia_3via_faixa[1], 0)} e Flávio ${fmtP(F.fatia_3via_faixa[0], 0)}–${fmtP(F.fatia_3via_faixa[1], 0)}; de quem voltou a votar, Lula ${fmtP(L.fatia_novos_faixa[0], 0)}–${fmtP(L.fatia_novos_faixa[1], 0)} e Flávio ${fmtP(F.fatia_novos_faixa[0], 0)}–${fmtP(F.fatia_novos_faixa[1], 0)}.</p>
  </div>`;
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
  return `<span class="br-chip" data-tip="${esc(titulo)}">${quem ? brDot(quem) : ""}${rot} ${fmtPP(pp)}</span>`;
}
// diferença a favor de Lula (> 0) → "Flávio +0,4"
function brChipLado(rot, d, titulo = "") {
  if (d == null) return "";
  return `<span class="br-chip" data-tip="${esc(titulo)}">${rot} ${Math.abs(d) < 0.05 ? "igual" : fmtDelta(d, 1, true)}</span>`;
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
    $("feed").innerHTML = `<div class="vazio">O feed não pôde ser montado agora. Nova tentativa na próxima atualização.</div>`;
  }
}
function renderAnaliseBrasil(est) {
  try { brAnalise(est); } catch (e) {
    console.error("análises do Brasil:", e);
    $("porque").innerHTML = brVazio("Análises do Brasil", "As análises não puderam ser montadas agora. Nova tentativa na próxima atualização.");
  }
}
function brFeed(est) {
  const a = est.brasil?.analise;
  $("feed-titulo").textContent = "Tudo o que entrou";
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
    ? `<span class="br-chip" data-tip="Municípios lidos pela primeira vez: o voto pode ter vindo em várias atualizações do TSE até a leitura">todos em 1ª leitura</span>`
    : `<span class="br-chip" data-tip="Municípios lidos pela primeira vez: o voto pode ter vindo em várias atualizações do TSE até a leitura">${fmtMi(v1a)} em 1ª leitura (${fmtN(t.municipios_1a_leitura)} municípios)</span>`;
  let h = `<div class="br-lote"><div class="br-lote-tot"><span class="k">Neste lote</span>
      <b>${fmtMi(t.validos)}</b> válidos · <b>${lider(t.lula_pct)}</b>
      ${brChipLado("vs esperado:", t.dif_pp, "Diferença entre o lote e o esperado para esses municípios pelo 1º turno, já com a divisão da 3ª via")}${primeira}</div>
    <div class="br-lote-regs">${lt.regioes.map((r) => `<div class="br-lote-reg">
      <span class="n">${esc(r.regiao)}</span><span class="v">${fmtN(100 * r.validos / t.validos)}% dos votos</span>
      ${brBarraLF(r.lula_pct)}<span class="v">${liderTxt(r.lula_pct)} ${brChipLado("", r.dif_pp, "Diferença entre o lote e o esperado para esses municípios pelo 1º turno, já com a divisão da 3ª via")}</span>
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
      <div class="br-mun"><b>${esc(e.nome)}</b> <span class="muted">${esc(e.uf)}</span><small>${esc(e.regiao)} · ${esc((e.hg || "").slice(0, 5))} · ${sec}</small></div>
      <div class="br-voto">${brBarraLF(e.lula_pct)}<span>Lula <b>${fmtP(pl)}</b> × Flávio <b>${fmtP(pf)}</b> <span class="muted">· ${fmtN(e.lula + e.flavio)} válidos</span></span></div>
      <div class="br-abs"><span class="k">abstenção</span> <b>${fmtP(e.abstencao_pct)}</b></div>
      <div class="br-chips">
        ${e.t1 ? brChipLado("vs 1º turno:", t1.lula_pp, `No 1º turno, só entre os dois: ${liderTxt(e.t1.lula_pct)}. A 3ª via teve ${fmtP(e.t1.outros_pct)}.`) : ""}
        ${e.t1 ? brChip("abst.", t1.abstencao_pp, qAb(t1.abstencao_pp), `Abstenção no 1º turno: ${fmtP(e.t1.abstencao_pct)}. A cor mostra quem se beneficia: abstenção maior onde um candidato vence tira votos dele.`) : ""}
        ${e.t1 && e.t1.outros_pct >= 1 ? `<span class="br-chip" data-tip="Votos dos outros candidatos no 1º turno, neste município">3ª via ${fmtP(e.t1.outros_pct, 0)}</span>` : ""}
        ${e.t22 ? brChipLado("vs 2022:", t22.lula_pp, `2º turno de 2022: ${liderTxt(e.t22.lula_pct, 1, "Bolsonaro")}, abstenção ${fmtP(e.t22.abstencao_pct)}. Do lado de Flávio, a referência é Bolsonaro.`) : ""}
        ${e.t22 ? brChip("abst.", t22.abstencao_pp, qAb(t22.abstencao_pp), `Abstenção em 2022: ${fmtP(e.t22.abstencao_pct)}`) : ""}
      </div></div>`;
  }).join("")}</div>`;
  if (ents.length > 10) h += `<button class="mais" data-exp="br-feed">${expandido["br-feed"] ? "Mostrar menos" : `Mostrar os ${ents.length} mais recentes`}</button>`;
  h += `<p class="nota-leitura">Cada linha mostra as urnas que acabaram de entrar num município. O lote junta o que o TSE publicou no mesmo minuto. "1ª leitura": tudo o que o município já tinha quando o painel o leu pela primeira vez. A comparação é com o município inteiro no 1º turno e em 2022, porque o TSE não publica seção a seção durante a totalização. A cor mostra a quem a diferença favorece.</p>`;
  $("feed").innerHTML = h;
}

// ---- cenário: o Brasil votando com as variáveis do exterior
function cartaoCenario(c, apurando) {
  if (!c || !c.brasil) return "";
  const b = c.brasil, lado = b.lula_pct >= 50 ? "l" : "f";
  const dpp = (r) => (r.lula_pct == null || r.lula_1t_pct == null ? null : r.lula_pct - r.lula_1t_pct);
  const faixas = c.faixas.map((f) => `<tr><td><b>${marca(f.lado)}${f.nome}</b><small>${descFaixa(f)} · ${fmtN(f.secoes)} seções no exterior</small></td>
      <td><b>${fmtP(f.terceira_lula, 0)}</b> / <b>${fmtP(f.terceira_flavio, 0)}</b><small>3ª via → Lula / Flávio</small></td>
      <td><b>${fmtP(f.novos_lula, 0)}</b> / <b>${fmtP(f.novos_flavio, 0)}</b><small>quem volta a votar → Lula / Flávio</small></td></tr>`).join("");
  const med = (r) => {
    const m = r.medido;
    if (!apurando) return "";
    if (!m) return `<td class="muted">aguardando</td>`;
    return `<td><b>${liderTxt(m.lula_pct)}</b><small>${fmtDelta(m.lula_pct - m.lula_1t_pct, 1, true)} vs 1º t. · ${fmtN(m.municipios)} mun.</small></td>`;
  };
  const linha = (r, nome, cls) => `<tr class="${cls}"><td>${nome}</td>
      <td>${liderTxt(r.lula_1t_pct)}</td>
      <td class="${r.lula_pct >= 50 ? "pct-l" : "pct-f"}"><b>${liderTxt(r.lula_pct)}</b><small>${fmtDelta(dpp(r), 1, true)}</small></td>
      <td><b>${sinalC(r.lula_3via + r.lula_novos)}</b><small>${sinalC(r.lula_3via)} 3ª via · ${sinalC(r.lula_novos)} comparec.</small></td>
      <td><b>${sinalC(r.flavio_3via + r.flavio_novos)}</b><small>${sinalC(r.flavio_3via)} 3ª via · ${sinalC(r.flavio_novos)} comparec.</small></td>
      <td>${fmtP(r.abst_1t, 1)} → <b>${fmtP(r.abst, 1)}</b></td>${med(r)}</tr>`;
  const linhas = c.regioes.map((r) => {
    const k = `cen-${r.regiao}`, aberto = !!expandido[k];
    const nome = `<button class="br-abre" data-exp="${k}" aria-expanded="${aberto}"><span class="seta">${aberto ? "−" : "+"}</span>${esc(r.regiao)}</button>`;
    return linha(r, nome, "br-reg") + (aberto ? r.ufs.map((u) => linha(u, `<span class="br-uf"><span class="nm">${esc(u.nome)} </span><span class="muted">${u.uf}</span></span>`, "br-ufl")).join("") : "");
  }).join("");
  const th = (rot, t) => `<th>${comTip(rot, t)}</th>`;
  return `<section class="painel cen">
    <header><h2>Cenário: o Brasil votando como o exterior ${ajuda("Simulação. O exterior mede, para cada tipo de lugar, como os votos da 3ª via e de quem volta a votar se dividem entre os dois. O cenário aplica essas proporções a cada município do Brasil, conforme o resultado dele no 1º turno.")}</h2><p>muda a cada boletim do exterior · ${fmtN(c.secoes_exterior)} seções</p></header>
    <div class="cen-topo">
      <div class="cen-res"><span class="k">Brasil no cenário</span><b class="${lado === "l" ? "pct-l" : "pct-f"}">${duoTxt(b.lula_pct)}</b>
        <small>${b.saldo_lula >= 0 ? "Lula" : "Flávio"} à frente por ${fmtC(Math.abs(b.saldo_lula))} votos · 1º turno, só os dois: ${duoTxt(b.lula_1t_pct)}</small></div>
      <p class="fl-frase">Cada município recebe as proporções que o exterior mede para a faixa dele no 1º turno: quanto da 3ª via e de quem volta a votar vai para cada um.
        A variação do comparecimento é a do próprio município entre o 1º e o 2º turno de 2022, porque a do exterior parte de uma abstenção muito diferente.</p>
    </div>
    <div class="sub-h">O que o exterior está mostrando ${ajuda("Seções do exterior agrupadas pelo resultado do 1º turno. Em cada grupo, a divisão estimada dos votos da 3ª via e de quem voltou a votar. Grupos com poucas seções ficam mais perto da média geral.")}</div>
    <table class="tabela cr-tab cen-var"><tbody>${faixas}</tbody></table>
    <div class="sub-h" style="margin-top:14px">Região por região</div>
    <div class="tabela-wrap"><table class="tabela br-t cen-t"><thead><tr><th>Região</th>${th("1º turno*", "Resultado do 1º turno de 2026, só entre os dois.")}${th("Cenário", "Resultado se a região repetisse o comportamento do exterior. Embaixo, quem ganha terreno em relação ao 1º turno.")}${th("Lula ganha", "Votos que Lula ganha no cenário: da 3ª via e da mudança no comparecimento.")}${th("Flávio ganha", "Votos que Flávio ganha no cenário: da 3ª via e da mudança no comparecimento.")}${th("Abstenção", "Abstenção no 1º turno → no cenário, pela variação de 2022.")}${apurando ? th("Medido agora*", "O que os municípios da região com 90% ou mais apurado estão mostrando de fato.") : ""}</tr></thead>
      <tbody>${linhas}</tbody></table></div>
    <p class="nota-leitura">* Só os votos dos dois. ${apurando ? "Medido agora: municípios com 90% ou mais apurado na região, comparados com o 1º turno deles. " : ""}O eleitor do exterior é diferente do eleitor do Brasil: o cenário mostra o que aconteceria se cada tipo de lugar repetisse o exterior. Não é previsão. Clique numa região para abrir os estados.</p>
  </section>`;
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
    <td class="opc">${liderTxt(r.lula_pct)}</td><td class="opc">${liderTxt(r.lula_1t_pct)}</td>
    <td>${r.lula_dif_1t_pp == null ? "—" : fmtDelta(r.lula_dif_1t_pp, 1, true)}</td></tr>`;
  const frase = pux == null ? "" : Math.abs(pux) < 0.3
    ? `No 1º turno, as urnas já contadas votaram como o Brasil inteiro (${liderTxt(g.lula_1t_contado_pct)}, só entre os dois). A parcial não está distorcida pela geografia.`
    : `No 1º turno, as urnas já contadas deram <b>${liderTxt(g.lula_1t_contado_pct)}</b>, contra ${liderTxt(g.lula_1t_brasil_pct)} no Brasil inteiro. Só pela geografia do que já entrou, a parcial está puxada <b>${fmtP(Math.abs(pux), 1).replace("%", " pp")}</b> para ${brDot(pux > 0 ? "l" : "f")}<b>${pux > 0 ? "Lula" : "Flávio"}</b>.`;
  return `<section class="painel"><header><h2>De onde vêm os votos ${ajuda("Compara o peso de cada região nos votos já contados com o peso dela no 1º turno. Se uma região entra mais rápido, a parcial fica puxada para quem vence ali.")}</h2><p>parcela dos válidos já contados × peso no 1º turno</p></header>
    <p class="br-frase">${frase}</p>
    <div class="br-legenda br-leg"><span><i class="c"></i>parcela no contado</span><span><i class="e"></i>parcela no 1º turno (válidos)</span></div>
    <div class="tabela-wrap br-wrap"><table class="tabela br-t"><thead><tr><th>Região</th><th></th>
      <th>Parcela<small>1º turno</small></th><th class="opc">Apurado</th><th class="opc">Agora</th><th class="opc">1º turno*</th><th>${comTip("Variação", "Quem ganhou terreno em relação ao 1º turno, nas mesmas urnas, em pontos percentuais.")}</th></tr></thead>
      <tbody>${brLinhas(a, "o", linha)}</tbody></table></div>
    <p class="nota-leitura">* Só os votos dos dois no 1º turno, nas mesmas urnas: a fração apurada de cada município aplicada ao resultado dele. Clique numa região para abrir os estados.</p></section>`;
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
  return `<section class="painel"><header><h2>Abstenção: quem ela prejudica ${ajuda("Abstenção que sobe igual em todo lugar não muda o placar. Ela pesa quando sobe mais onde um dos candidatos é mais forte.")}</h2><p>mesmas urnas</p></header>
    <p class="br-frase">${frase}</p>
    <div class="tabela-wrap br-wrap"><table class="tabela br-t"><thead><tr><th>Região</th><th>Agora</th><th class="opc">1º turno</th><th class="opc">2022</th><th>vs 1º turno</th><th>${comTip("Efeito no saldo", "Votos de vantagem que a mudança na abstenção deu a um dos dois: o saldo de agora menos o saldo se cada município tivesse comparecido como no 1º turno.")}</th></tr></thead>
      <tbody>${brLinhas(a, "a", linha, true)}</tbody></table></div>
    <p class="nota-leitura">Efeito: o saldo de agora menos o saldo que haveria se cada município tivesse comparecido como no 1º turno, votando como está votando. Em municípios ainda parciais, parte da diferença vem só da ordem em que as seções entram.</p></section>`;
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
      h += `<i data-tip="${nome}: ${fmtP(v, 0)}" style="left:${X(a0)}%;width:${Math.max(0, X(a1) - X(a0))}%;background:${cor}${v < 0 ? ";opacity:.55" : ""}"></i>`;
    }
    return `<span class="br-emp"><b class="zero" style="left:${X(0)}%"></b><b class="cem" style="left:${X(100)}%"></b>${h}</span>`;
  };
  const linha = (r, nome, cls) => `<tr class="${cls}"><td>${nome}</td><td class="opc">${r.outros_1t > 0 ? fmtMi(r.outros_1t) : "—"}</td>
    <td class="br-empc">${barra(r)}</td>
    <td>${r.lula_entre_os_dois_pct == null ? "—" : liderTxt(r.lula_entre_os_dois_pct, 0)}</td><td class="opc">${r.alpha_pct == null || cls === "br-ufl" ? "" : `${fmtP(r.alpha_pct, 0)} / ${fmtP(100 - r.alpha_pct, 0)}`}</td></tr>`;
  const t = a.total, d = t.destino || {};
  const frase = t.outros_1t > 0 ? `Nas urnas contadas, os outros candidatos tiveram <b>${fmtMi(t.outros_1t)}</b> votos no 1º turno. Do 1º para o 2º turno:
    ${BR_DEST.map(([k, n]) => `${k === "lula" || k === "flavio" ? n : n.toLowerCase()} <b>${brVS(t.destino_votos[k])}</b>`).join(", ")}.` : "";
  return `<section class="painel"><header><h2>Para onde foi a 3ª via ${ajuda(DICA.terceira)}</h2><p>contas nas mesmas urnas</p></header>
    <p class="br-frase">${frase}</p>
    <div class="br-legenda">${BR_DEST.map(([k, n, c]) => `<span><i style="background:${c}"></i>${n} ${fmtP(d[k], 0).replace("-", "−")}</span>`).join("")}</div>
    <div class="tabela-wrap br-wrap"><table class="tabela br-t"><thead><tr><th>Região</th><th class="opc">3ª via no 1º turno</th><th class="br-empc">variação, em % dos votos da 3ª via</th><th>Placar</th><th class="opc">${comTip("Lula / Flávio", "Divisão da 3ª via estimada comparando os municípios entre si. É o número que a projeção usa.")}</th></tr></thead>
      <tbody>${brLinhas(a, "t", linha, true)}</tbody></table></div>
    <p class="nota-leitura">Quanto Lula, Flávio, brancos e nulos e a abstenção variaram do 1º para o 2º turno, como fração dos votos da 3ª via. É uma conta de saldo, não o caminho de cada eleitor: quem votou num candidato no 1º turno pode ter faltado e ser compensado por outro. As linhas marcam 0% e 100%. Em municípios ainda parciais, parte do número vem da ordem de apuração.</p></section>`;
}
function brAnalise(est) {
  const a = est.brasil?.analise, el = $("porque");
  if (est.fase !== "apurando" || !a || !a.total?.validos) {
    el.innerHTML = cartaoCenario(est.brasil?.cenario, false) + `<section class="painel"><header><h2>Por que cada um cresce, medido no Brasil</h2><p>aparece às 17h</p></header>
      <ul class="lista-espera"><li><b>De onde vêm os votos:</b> quanto do contado vem de cada região, comparado com o peso dela no 1º turno.</li>
      <li><b>Abstenção:</b> onde ela subiu ou caiu e a quem isso prejudica.</li>
      <li><b>3ª via:</b> para onde foram, região a região, os votos dos outros candidatos do 1º turno.</li></ul></section>`;
    return;
  }
  const min = est.min_apurado ?? 5, cedo = !(a.total.apurado_pct >= min);
  const cr = cedo ? "" : cartaoCrescimento(est.brasil.crescimento)
    || `<section class="painel"><header><h2>Por que cada um cresce</h2></header><div class="vazio">Aparece quando houver 30 municípios com 90% ou mais apurado: antes disso a conta mede mais a ordem de apuração do que o voto.</div></section>`;
  el.innerHTML = (cr || "") + cartaoCenario(est.brasil?.cenario, true) + brOrigem(a) + `<details class="painel br-det" ${expandido["br-det"] ? "open" : ""}><summary><h2>Região por região: abstenção e 3ª via</h2><span>contas nas mesmas urnas</span></summary>
    <div class="br-dupla">${brAbstencao(a, cedo, min)}${brTerceira(a, cedo, min)}</div></details>`;
  el.querySelector(".br-det").addEventListener("toggle", (ev) => { expandido["br-det"] = ev.target.open; });
}

// ================================================================ método (recolhido)
function metodo(p, escopo, est) {
  if (!p || !p.contado || p.lula_pct == null) return `<p class="vazio">Aparece junto com a projeção.</p>`;
  const br = escopo === "brasil", u = br ? "município" : "cidade", us = br ? "municípios" : "cidades";
  const alfa = p.alpha_regiao ? Object.entries(p.alpha_regiao).map(([r, a]) => `${r} ${fmtP(a, 0)}`).join(" · ") : "";
  let h = `<div class="passos3">
    <div class="passo"><div class="n">1 · Base</div><div class="big">${fmtN(p.municipios.completos + p.municipios.parciais)} ${us}</div>
      <p>já têm voto. Cada ${u} tem uma base: o resultado dele no 1º turno, com os votos da 3ª via divididos como estão se dividindo nas urnas já contadas${alfa ? ` (parte que vai para Lula: ${alfa}; o resto vai para Flávio)` : ""}.</p></div>
    <div class="passo"><div class="n">2 · Desvio</div><div class="big">${fmtDelta(p.desvio_medio_pp, 1, true)}</div>
      <p>é quanto o voto real está se afastando da base, em média, onde já se contou. Cada ${u} que falta recebe a sua base mais o desvio ${br ? "do seu estado (puxado para o da região quando o estado tem pouco voto)" : "médio do exterior"}.</p></div>
    <div class="passo"><div class="n">3 · Incerteza</div><div class="big">${liderTxt(p.p10)} a ${liderTxt(p.p90)}</div>
      <p>é a faixa de 80% em ${br ? 300 : 200} simulações, que sorteiam de novo as urnas contadas e somam um erro extra a cada ${br ? "estado" : "país"} que falta. A faixa estreita conforme a apuração avança.</p></div>
  </div>`;
  const en = est.ensaio_2022;
  if (br && en && en.pontos?.length) {
    h += `<h3>O mesmo método na apuração de 2022</h3><p class="cascata-nota" style="margin:0 0 8px">A apuração do 2º turno de 2022 foi refeita zona a zona, cidades pequenas primeiro, com o 1º turno como base.
      O contado começou em ${liderTxt(en.pontos[0].parcial, 1, "Bolsonaro")} e mudou bastante ao longo da noite; a projeção ficou perto do resultado final (${liderTxt(en.real, 2, "Bolsonaro")}) desde o começo.</p>
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
  if (MODOS[m]?.so && MODOS[m].so !== escopo) m = "proj";
  if (m === "cenario" && !est.brasil?.cenario) m = "t1";
  if (!ok && (m === "proj" || m === "desvio")) m = br && est.fase !== "apurando" ? "t1" : "contado";
  const notas = {
    proj: br ? "Resultado esperado no fim, município a município: o contado onde já há voto, a projeção onde falta." : "Resultado esperado no fim, país a país. O tamanho da bolha segue o eleitorado.",
    contado: "Só o que já foi contado. Cinza: ainda sem votos.",
    desvio: "Quanto cada lugar está votando diferente da base (1º turno com a 3ª via dividida). A projeção aplica esse desvio ao que falta.",
    andamento: br ? "Quanto de cada município já foi apurado." : "Quanto das seções de cada país já chegou.",
    t1: "Resultado do 1º turno de 2026, só entre os dois. É a referência da projeção.",
    cenario: "Cada município votando com as proporções que o exterior mostra para a faixa dele no 1º turno. É uma simulação, não a projeção.",
  };
  $("modos").innerHTML = Object.entries(MODOS).filter(([, v]) => !v.so || v.so === escopo).map(([k, v]) =>
    `<button data-modo="${k}" aria-pressed="${k === m}" data-tip="${esc(!ok && (k === "proj" || k === "desvio") ? "Aparece junto com a projeção. " + notas[k] : notas[k])}" ${!ok && (k === "proj" || k === "desvio") ? "aria-disabled='true' class='off'" : ""}>${v.rot}</button>`).join("");
  $("mapa-acoes").innerHTML = br
    ? (sel.brasil ? `<button class="chip-btn" data-sel="">← Brasil inteiro</button>` : "")
    : PRESETS.map((p) => `<button class="chip-btn" data-preset="${p.id}">${p.rot}</button>`).join("");
  $("legenda-mapa").innerHTML = legenda(m);
  $("mapa-nota").textContent = notas[m];
  const modoEfetivo = modo[escopo]; modo[escopo] = m;
  if (br) pintarBR(); else pintarMundo();
  modo[escopo] = modoEfetivo;
}

function renderBrasil(est) {
  const b = est.brasil || {}, P = b.modelos || {}, p = P[MODELO], alt = P[MODELO_ALT];
  // o estado traz só o que muda; nome, UF, eleitorado e 1º turno vêm de /api/municipios, baixado uma vez
  MUN = {};
  for (const r of b.mapa || []) { const f = FIX?.[r[0]] || [r[0], "", "", 0, null]; MUN[r[0]] = [r[0], f[1], f[2], f[3], r[1], r[2], r[3], r[4], f[4]]; }
  const ok = brOk(), n = est.nacional, mk = est.mercados || {};
  const cas = ok ? passosCascata(p, agruparRegioes(p.por_uf), (g) => g.grupo) : null;
  $("hero").innerHTML = hero("brasil", est, p, alt, cas);
  $("aovivo").innerHTML = aoVivoBrasil(est);
  $("chances").innerHTML = blocoChances(ok ? p.prob_lula : null, mk.polymarket?.p_lula, mk.kalshi?.p_lula, "Brasil");
  // seleção
  const u = sel.brasil;
  if (u) {
    const g = (p?.por_uf || []).find((x) => x.grupo === u), r1 = (b.por_uf || []).find((x) => x.uf.toLowerCase() === u);
    $("selecao").hidden = false;
    $("selecao").innerHTML = `<button class="sel-x" data-sel="" aria-label="Fechar">×</button><div class="nome-sel">${esc(r1?.nome || u.toUpperCase())}</div>
      <div class="sub-sel">${fmtP(g?.apurado_pct ?? r1?.apurado_pct, 1)} apurado · ${fmtMi(g?.eleitorado)} eleitores</div>
      <div class="grade-sel">
        <div><span class="k">Contado</span><span class="v">${lider(g?.lula_contado_pct)}</span></div>
        <div><span class="k">${comTip("Projeção", DICA.projecao)}</span><span class="v">${ok ? lider(g?.lula_final_pct) : "—"}</span></div>
        <div><span class="k">1º turno, mesmas urnas*</span><span class="v">${lider(r1?.lula_1t_pct)}</span></div>
        <div><span class="k">${comTip("Saldo do que falta", DICA.saldo)}</span><span class="v">${ok ? saldoTxt(g?.saldo_esperado) : "—"}</span></div>
      </div><p class="selecao dica" style="margin:10px 0 0">* só os votos dos dois</p>`;
  } else {
    $("selecao").hidden = true;
  }
  $("cascata-titulo").textContent = "O que falta";
  $("cascata-sub").textContent = ok ? "do contado à projeção, região por região" : "";
  $("cascata").innerHTML = ok ? cascata(cas) + `<p class="cascata-nota">Cada linha soma ao contado os votos que ainda faltam de uma região, com o resultado esperado ali.</p>` : `<div class="vazio">Aparece com 5% do eleitorado apurado, depois das 17h.</div>`;
  const hist = (b.hist || []).filter((h) => h.modelo === MODELO);
  $("noite-sub").textContent = hist.length ? `${hist.length} ${hist.length === 1 ? "atualização" : "atualizações"} do TSE · eixo: L = Lula à frente, F = Flávio à frente` : "";
  grafico($("noite"), {
    aria: "Projeção e contado ao longo da apuração", vazio: "Começa com a primeira totalização do TSE, às 17h. Cada atualização vira um ponto: o contado e a projeção com a faixa provável.",
    xFmt: (v) => fmtP(v, 0) + " apurado", xMin: 0, refs: [{ y: 50, label: "empate" }], yFmt: ladoEixo, tipFmt: (v) => liderTxt(v),
    series: [
      { nome: "Contado", cor: "var(--parcial)", pts: hist.map((h) => ({ x: h.apurado, y: h.parcial })) },
      { nome: "Projeção", cor: "var(--text)", banda: true, pts: hist.map((h) => ({ x: h.apurado, y: h.p50, lo: h.p10, hi: h.p90 })) },
    ],
  });
  // tabela
  $("tabela-titulo").textContent = "Estados";
  const g = ok ? (p.por_uf || []).slice() : [];
  if (ok) {
    $("tabela-sub").textContent = "ordenados pelo peso no resultado · clique num estado para vê-lo no mapa";
    // no celular cada estado ocupa duas linhas: mostra os 10 que mais pesam e o resto sob demanda
    const curta = matchMedia("(max-width: 760px)").matches && !expandido.ufs && g.length > 10;
    $("tabela").innerHTML = cabTabela("Estado") + `<tbody>${(curta ? g.slice(0, 10) : g).map((x) => linhaTabela(x.grupo, x.nome, x.grupo === "zz" ? "" : x.grupo.toUpperCase(), x.apurado_pct, x.lula_contado_pct, x.lula_final_pct, x.saldo_esperado, maxSaldo(g))).join("")}</tbody>`;
  } else {
    $("tabela-sub").textContent = "";
    $("tabela").innerHTML = `<tbody><tr><td class="vazio">Aparece com a projeção, depois das 17h.</td></tr></tbody>`;
  }
  $("tabela-mais").innerHTML = ok && g.length > 10 && matchMedia("(max-width: 760px)").matches
    ? `<button class="mais" data-exp="ufs">${expandido.ufs ? "Mostrar só os 10 que mais pesam" : `Mostrar os ${g.length} estados`}</button>` : "";
  renderFeedBrasil(est);
  renderAnaliseBrasil(est);
  renderMetodo(p, "brasil", est);
}

function cabTabela(rot) {
  return `<thead><tr><th>${rot}</th><th>${comTip("Apurado", DICA.apurado)}</th><th>Contado</th><th>${comTip("Projeção", DICA.projecao)}</th><th>${comTip("Saldo do que falta", DICA.saldo)}</th></tr></thead>`;
}
const maxSaldo = (g) => Math.max(...g.map((x) => Math.abs(x.saldo_esperado || 0))) || 1;
function linhaTabela(chave, nome, sub, ap, contado, proj, saldo, max) {
  const w = (50 * Math.abs(saldo || 0)) / max;
  const bar = saldo >= 0 ? `left:50%;width:${w}%;background:var(--lula)` : `left:${50 - w}%;width:${w}%;background:var(--flavio)`;
  const cls = (v) => (v == null ? "" : v >= 50 ? "pct-l" : "pct-f");
  const atual = aba === "exterior" ? sel.exterior : sel.brasil;
  return `<tr data-sel="${esc(chave)}" class="${atual === chave ? "on" : ""}"><td class="nome"><b>${esc(nome)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</td>
    <td><span class="ap">${fmtP(ap, 0)}<i><b style="width:${ap || 0}%"></b></i></span></td>
    <td class="${cls(contado)}" data-k="Contado">${liderTxt(contado)}</td><td class="${cls(proj)}" data-k="Projeção">${liderTxt(proj)}</td>
    <td data-k="Saldo do que falta"><span class="saldo"><span>${saldo == null ? "—" : saldoTxt(saldo)}</span><span class="div"><i style="${bar}"></i></span></span></td></tr>`;
}

function renderExterior(est) {
  const x = est.exterior || {}, P = x.modelos || {}, p = P[MODELO], alt = P[MODELO_ALT], mk = est.mercados || {};
  const ok = !!(p && p.disponivel && p.lula_pct != null);
  const proj = {}; for (const g of p?.por_pais || []) proj[g.grupo] = g;
  PAIS = {}; for (const r of x.paises || []) if (r.iso3) PAIS[r.iso3] = { ...r, proj: ok ? proj[r.pais] : null };
  const cas = ok ? passosCascata(p, agruparPaises(p.por_pais), (g) => g.grupo) : null;
  $("hero").innerHTML = hero("exterior", est, p, alt, cas);
  $("aovivo").innerHTML = aoVivoExterior(est);
  $("porque").innerHTML = cartaoCrescimento(x.crescimento, x.placar)
    || `<section class="painel"><header><h2>Por que cada um cresce</h2></header><div class="vazio">Aparece quando houver 20 seções que existem nos dois turnos.</div></section>`;
  $("chances").innerHTML = blocoChances(ok ? p.prob_lula : null, mk.polymarket?.exterior_lula, mk.kalshi?.exterior_lula, "no exterior");
  const s = sel.exterior && PAIS[sel.exterior];
  if (s) {
    $("selecao").hidden = false;
    $("selecao").innerHTML = `<button class="sel-x" data-sel="" aria-label="Fechar">×</button><div class="nome-sel">${esc(s.pais)}</div>
      <div class="sub-sel">${s.secoes} de ${s.secoes_tot} seções · ${fmtN(s.eleitorado)} eleitores</div>
      <div class="grade-sel">
        <div><span class="k">Contado</span><span class="v">${s.secoes ? lider(s.lula_pct) : "—"}</span></div>
        <div><span class="k">${comTip("Projeção", DICA.projecao)}</span><span class="v">${s.proj ? lider(s.proj.lula_final_pct) : "—"}</span></div>
        <div><span class="k">1º turno*</span><span class="v">${lider(s.lula_1t_final_2v_pct)}</span></div>
        <div><span class="k">${comTip("Saldo do que falta", DICA.saldo)}</span><span class="v">${s.proj ? saldoTxt(s.proj.saldo_esperado) : "—"}</span></div>
      </div><p class="dica" style="margin:10px 0 0">* só os votos dos dois, no país inteiro</p>`;
  } else {
    $("selecao").hidden = true;
  }
  $("cascata-titulo").textContent = "O que falta";
  $("cascata-sub").textContent = ok ? "do contado à projeção, pelos países que mais pesam" : "";
  $("cascata").innerHTML = ok ? cascata(cas) + `<p class="cascata-nota">Cada linha soma ao contado os votos que ainda faltam de um país, com o resultado esperado ali.</p>` : `<div class="vazio">Aparece com 2% do eleitorado do exterior apurado.</div>`;
  const h = x.hist || [];
  $("noite-sub").textContent = "hora em que cada boletim chegou ao TSE · eixo: L = Lula à frente, F = Flávio à frente";
  grafico($("noite"), {
    aria: "Projeção do exterior ao longo do dia", xFmt: fmtHora, refs: [{ y: 50, label: "empate" }], yFmt: ladoEixo, tipFmt: (v) => liderTxt(v),
    series: [
      { nome: "Contado", cor: "var(--parcial)", pts: h.map((r) => ({ x: tms(r.t), y: r.parcial, extra: `${r.secoes} seções` })) },
      { nome: "Projeção", cor: "var(--text)", banda: true, pts: h.map((r) => ({ x: tms(r.t), y: r.p50, lo: r.p10, hi: r.p90 })) },
    ],
  });
  // tabela de países
  const linhas = Object.values(PAIS).map((r) => ({ ...r, saldo: r.proj?.saldo_esperado ?? 0 }))
    .sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo) || b.eleitorado - a.eleitorado);
  const max = Math.max(...linhas.map((r) => Math.abs(r.saldo))) || 1;
  const lista = expandido.paises ? linhas : linhas.slice(0, 15);
  $("tabela-titulo").textContent = "Países";
  $("tabela-sub").textContent = `${linhas.filter((r) => r.secoes).length} de ${linhas.length} com boletim · clique num país para vê-lo no mapa`;
  $("tabela").innerHTML = cabTabela("País") + `<tbody>${lista.map((r) => linhaTabela(r.iso3, r.pais, `${r.secoes}/${r.secoes_tot}`,
    r.secoes_tot ? (100 * r.secoes) / r.secoes_tot : 0, r.secoes ? r.lula_pct : null, r.proj?.lula_final_pct, ok ? r.saldo : null, max)).join("")}</tbody>`;
  $("tabela-mais").innerHTML = linhas.length > 15 ? `<button class="mais" data-exp="paises">${expandido.paises ? "Mostrar só os 15 maiores" : `Mostrar todos (${linhas.length})`}</button>` : "";
  renderFeedExterior(est);
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
      yFmt: (v) => ladoEixo(v, "B"), tipFmt: (v) => liderTxt(v, 1, "Bolsonaro"),
      refs: [{ y: en.real, label: `resultado final: ${liderTxt(en.real, 2, "Bolsonaro")}`, cor: "var(--text-2)" }],
      series: [
        { nome: "Contado", cor: "var(--parcial)", pts: en.pontos.map((h) => ({ x: h.apurado, y: h.parcial })) },
        { nome: "Projeção", cor: "var(--text)", banda: true, pts: en.pontos.map((h) => ({ x: h.apurado, y: h.p50, lo: h.p10, hi: h.p90 })) },
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
    // passo cresce com a amplitude: um valor absurdo de uma API não gera um laço sem fim
    const passo = [0.25, 0.5, 1, 2, 5, 10, 20, 25, 50].find((q) => (y1 - y0) / q <= 4) || Math.max(50, (y1 - y0) / 4);
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
  const ok = brOk(), p = est.brasil?.modelos?.[MODELO], pe = est.exterior?.modelos?.[MODELO];
  // ---------- agora ----------
  const delta = (s, desde) => { const a = ultimo(s, desde), b = ultimo(s, agora); return a == null || b == null ? null : b - a; };
  const marg = S.fatia.map((q) => [q[0], margemDe(q[1])]);
  const prox = mv.ondas.find((o) => !o.fechou && o.eleitorado >= 1000);
  const card = (rot, corpo, pe, cls = "") => `<div class="mk-card ${cls}"><div class="rot">${rot}</div>${corpo}<div class="pe">${pe}</div></div>`;
  const pct = (x) => (x == null ? null : 100 * x);
  // cartão "quem vence": manchete com o favorito pela média das fontes, e a barra dividida de cada fonte
  const cardVence = (rot, fontes) => {
    // manchete: só a média dos mercados; o modelo do painel aparece como linha própria
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
      ...(ok ? [{ nome: "Modelo do painel", v: p.prob_lula, modelo: true }] : [])]) +
    card("Diferença esperada pela Kalshi", `<div class="mk-grande">${margK == null ? "" : marca(margK >= 0 ? "l" : "f")}${fmtMargem(margK)}</div>
      <div class="mk-linha"><span>desde 00h</span>${fmtDelta(delta(marg, 0), 2)}</div><div class="mk-linha"><span>última hora</span>${fmtDelta(delta(marg, agora - 60), 2)}</div>`,
      "diferença entre os dois nos votos válidos, pelo valor do meio das apostas da Kalshi") +
    cardVence("Quem vence no exterior", [
      { nome: "Polymarket", v: pct(pm.exterior_lula), d: delta(S.poly_ext, 0) }, { nome: "Kalshi", v: pct(k.exterior_lula), d: delta(S.kalshi_ext, 0) },
      ...(pe?.disponivel && pe.prob_lula != null ? [{ nome: "Modelo do painel", v: pe.prob_lula, modelo: true }] : [])]) +
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
        ...(nossoProb.length ? [{ nome: "Painel", tipNome: "Modelo do painel", cor: "var(--text)", pts: nossoProb, tracejada: true }] : []) ]),
      { titulo: `Diferença esperada: ${FM} à frente`, sub: "nos votos válidos · Kalshi, valor do meio das apostas", h: 100, padMin: 0.3,
        lados: { ref: 0, acima: { c: favM, rot: `${FM} à frente` }, abaixo: { c: outro(favM), rot: `${OM} à frente` } },
        yFmt: (v, tip) => (tip ? fmtMargem(convM(v), 2) : (v >= 0 ? "" : `${OM} `) + Math.abs(v).toFixed(1).replace(".", ",")),
        rotFmt: (v) => `${v >= 0 ? FM : OM} +${Math.abs(v).toFixed(2).replace(".", ",")} pp`, series: [
        { nome: "Kalshi", tipNome: "Diferença (Kalshi)", cor: "var(--kalshi)", pts: marg.map((q) => [q[0], convM(q[1])]), ate: agora, fina: true },
        ...(nossoMarg.length ? [{ nome: "Painel", tipNome: "Diferença (modelo do painel)", cor: "var(--text)", pts: nossoMarg.map((q) => [q[0], convM(q[1])]), tracejada: true }] : []) ] },
      painelChance("Quem vence no exterior", 80, favExt, [
        { nome: "Polymarket", tipNome: "Exterior · Polymarket", cor: "var(--poly)", pts: S.poly_ext, ate: agora },
        { nome: "Kalshi", tipNome: "Exterior · Kalshi", cor: "var(--kalshi)", pts: S.kalshi_ext, ate: agora } ], true),
      { titulo: "Exterior: placar dos boletins já contados", sub: "barras: boletins recebidos a cada 15 min", h: 90, yFmt: (v, tip) => (tip ? liderTxt(v) : ladoEixo(v)), ref: 50, padMin: 3,
        barMax: Math.max(...barras.map((b) => b.v), 1) * 2.2, barras, series: [
        { nome: "Placar", tipNome: "Exterior, acumulado", cor: "var(--text)", pts: extPct, degrau: true, ate: extPct.length ? agora : null } ] },
    ],
    marcos: mv.ondas.map((o) => ({ x: o.min, forte: o.eleitorado >= 10000, rot: o.paises[0], peso: o.eleitorado,
      tip: `${hhmm(o.min)} fecham ${nomeOnda(o, 4)} (${fmtMi(o.eleitorado)} eleitores)` })),
    faixas: mv.episodios.map((e, i) => ({ de: e.de, ate: e.ate, rot: String(i + 1) })),
  });
  // ---------- tabela por fechamento ----------
  const lista = mv.ondas.filter((o) => expandido.ondas || o.eleitorado >= 1000);
  const mvd = (o, chave, dec = 1) => { const v = o.mercado?.[chave]; return v && v[0] != null && v[1] != null ? fmtDelta(v[1] - v[0], dec, true) : `<span class="muted">—</span>`; };
  $("mk-ondas").innerHTML = `<thead><tr><th>Fecha</th><th>Quem</th><th>Eleitores</th><th>Boletins</th><th>Quem lidera nos boletins</th><th>× 1º turno*</th>
      <th>${comTip("Chance de vencer", "Quanto a chance média de vitória nos mercados andou de 15 min antes a 90 min depois do fechamento.")}</th><th>${comTip("Diferença esperada", "Quanto a diferença esperada entre os dois (Kalshi) andou na mesma janela.")}</th><th>Quem vence no exterior</th></tr></thead><tbody>` +
    lista.map((o) => {
      const d1 = o.lula_pct != null && o.lula_1t_pct != null ? o.lula_pct - o.lula_1t_pct : null;
      const futuro = !o.fechou;
      const parcial = o.fechou && o.mercado_ate != null && o.mercado_ate < o.min + 90;
      return `<tr class="${futuro ? "futuro" : ""}"><td><b>${hhmm(o.min)}</b></td>
        <td class="quem" data-tip="${esc(o.paises.join(", "))}">${esc(nomeOnda(o))}</td>
        <td>${fmtMi(o.eleitorado)}</td>
        <td>${futuro ? `<span class="muted">em ${Math.round(o.min - agora)} min</span>` : `${o.bus}/${o.secoes}`}</td>
        <td>${o.lula_pct == null ? `<span class="muted">—</span>` : (({ c, nome, v }) => `<span class="mk-d">${marca(c)}${nome} ${fmtP(v)}</span>`)(favorito(o.lula_pct))}</td>
        <td>${fmtDelta(d1, 1, true)}</td>
        <td>${futuro ? "" : mvd(o, "chance")}</td><td>${futuro ? "" : mvd(o, "margem", 2)}</td><td>${futuro ? "" : mvd(o, "kalshi_ext")}${parcial ? ` <span class="muted" data-tip="Ainda não passaram 90 min">…</span>` : ""}</td></tr>`;
    }).join("") + `</tbody>`;
  const nPeq = mv.ondas.filter((o) => o.eleitorado < 1000).length;
  $("mk-ondas-mais").innerHTML = (nPeq ? `<button class="mais" data-exp="ondas">${expandido.ondas ? "Esconder os fechamentos pequenos" : `Mostrar também ${nPeq} fechamentos com menos de mil eleitores`}</button>` : "") +
    `<p class="nota-leitura" style="margin-top:8px">Variações em pontos percentuais, com o nome de quem ganhou terreno. * Boletins já chegados comparados com o 1º turno nas mesmas cidades, só entre os dois. "Quem vence no exterior" é o mercado da Kalshi.</p>`;
  // ---------- episódios ----------
  const chanceTxt = (pL) => { const [l, f] = par(pL, 1); return `Lula ${fmtP(l)} × Flávio ${fmtP(f)}`; };
  $("mk-ep-sub").textContent = `quando a chance média andou ${fmtP(mv.limiar_pp, 1).replace("%", " pp")} ou mais em ${mv.janela_min} min`;
  $("mk-episodios").innerHTML = mv.episodios.length ? mv.episodios.map((e, i) => {
    const fech = e.fecharam.length ? `Fecharam por perto: <b>${esc(e.fecharam.slice(0, 4).map((f) => f.pais).join(", "))}</b> (${fmtMi(e.fecharam_eleitorado)} eleitores).` : "Nenhum fechamento do exterior por perto.";
    const bus = e.boletins ? `${e.boletins === 1 ? "Chegou 1 boletim" : `Chegaram ${e.boletins} boletins`}${e.bu_paises.length ? ` (${esc(e.bu_paises.join(", "))})` : ""}: ${duoTxt((100 * e.bu_lula) / Math.max(1, e.bu_lula + e.bu_flavio))}.` : "Nenhum boletim chegou nessa janela.";
    return `<div class="ep"><div class="ep-n">${i + 1}</div><div>
      <div class="ep-t">${hhmm(e.de)}–${hhmm(e.ate)} · ${fmtDelta(e.delta)}</div>
      <div class="ep-c">Chance de vitória: ${chanceTxt(e.chance_de)} → ${chanceTxt(e.chance_ate)}</div>
      <div class="ep-d">Diferença esperada: ${fmtMargem(e.margem[0], 2)} → ${fmtMargem(e.margem[1], 2)}. ${fech} ${bus}</div></div></div>`;
  }).join("") : `<div class="vazio">Nenhum movimento forte até agora: o mercado andou devagar.</div>`;
  // ---------- retrato (recolhido) ----------
  if (!$("mk-detalhes").open) return;
  grafico($("mk-escada"), {
    aria: "Escada da Kalshi", xFmt: (v) => fmtP(v, 1), yMin: 0, yMax: 100, refs: [{ y: 50 }],
    vrefs: ok ? [{ x: p.lula_pct, label: "modelo do painel", solida: true, cor: "var(--text)" }] : [],
    series: [{ nome: "Kalshi", cor: "var(--kalshi)", pts: (k.escada_lula || []).map((e) => ({ x: e.limiar, y: 100 * e.prob })) }],
  });
  const margem = ok ? 2 * p.lula_pct - 100 : null;
  $("mk-margem").innerHTML = `<div class="sub-h">Margem · Kalshi</div>${baldesMargem(k.margem, margem)}<div class="sub-h">Margem · Polymarket</div>${baldesMargem(pm.margem, margem)}`;
  const comp = (pm.comparecimento || []).map((c) => `<div class="balde"><span class="rot">${esc(c.rotulo)}</span><div class="b" style="width:${100 * (c.prob || 0)}%;background:var(--poly)"></div><span class="p">${fmtP(100 * (c.prob || 0), 0)}</span></div>`).join("");
  $("mk-comp").innerHTML = `<div class="sub-h">Comparecimento · Polymarket (Kalshi: valor do meio ${k.comparecimento_mediana ? fmtN(k.comparecimento_mediana) : "—"} votantes; 1º turno: 78,9%)</div><div class="baldes">${comp}</div>`;
}

// ================================================================ Coleta
function renderColeta(est) {
  const s = est.saude || {};
  const idade = (ts) => (ts ? Math.round((Date.now() - new Date(ts).getTime()) / 1000) : null);
  const nomes = { vigia: "Vigia", oficial: "Totalização oficial", exterior: "Exterior (BUs)", mercados: "Mercados", cruzamento_ascaribe: "Cruzamento com ascaribe" };
  const c = est.coleta || {};
  $("cl-sub").textContent = `BUs ${c.bu_secoes}/${c.secoes_ext} · municípios lidos ${c.municipios_lidos} · bases ${Object.entries(est.bases_ok || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`;
  $("cl-saude").innerHTML = `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Coletor</th><th>Último sinal</th><th>Há</th><th style="text-align:left">Detalhe</th></tr></thead><tbody>` +
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
    ? `<span><b>${fmtP(n.apurado_pct, 2)}</b> apurado</span><span class="trilho"><i style="width:${n.apurado_pct}%"></i></span><span>TSE ${esc(n.hg?.slice(0, 5) || "")}</span>`
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

function initDicas() {
  const tip = $("tooltip");
  let alvo = null;
  const mostrar = (el) => {
    alvo = el;
    tip.hidden = false;
    tip.innerHTML = `<div class="tt-d">${esc(el.dataset.tip)}</div>`;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let top = r.bottom + 8;
    if (top + h > innerHeight - 8) top = r.top - h - 8;
    tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
    tip.style.top = Math.max(8, top) + "px";
  };
  const esconder = () => { if (alvo) { alvo = null; tip.hidden = true; } };
  document.addEventListener("mouseover", (ev) => {
    const el = ev.target.closest?.("[data-tip]");
    if (el && el.dataset.tip) { if (el !== alvo) mostrar(el); } else esconder();
  });
  document.addEventListener("focusin", (ev) => { const el = ev.target.closest?.("[data-tip]"); if (el && el.dataset.tip) mostrar(el); });
  document.addEventListener("focusout", esconder);
  addEventListener("scroll", esconder, { passive: true });
  // a página se redesenha a cada 10 s: dica de um elemento que sumiu some junto
  setInterval(() => { if (alvo && !alvo.isConnected) esconder(); }, 500);
}

function initUI() {
  initDicas();
  document.querySelectorAll(".escopos button").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.aba)));
  window.addEventListener("hashchange", () => irPara((location.hash || "#brasil").slice(1)));
  document.addEventListener("click", (ev) => {
    const md = ev.target.closest("[data-modo]");
    if (md && !md.classList.contains("off")) {
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
    const ro = ev.target.closest("[data-rolar]");
    if (ro) { $(ro.dataset.rolar).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const ex = ev.target.closest("[data-exp]");
    if (ex) { expandido[ex.dataset.exp] = !expandido[ex.dataset.exp]; if (EST) render(EST); }
  });
  $("metodo").addEventListener("toggle", () => { if ($("metodo").open && EST) render(EST); });
  $("mk-detalhes").addEventListener("toggle", () => { if ($("mk-detalhes").open && EST) render(EST); });
  irPara((location.hash || "#brasil").slice(1));
}

async function ciclo() {
  if (document.hidden && EST) return; // aba em segundo plano (celular bloqueado) não gasta dados
  try {
    const r = await fetch("/api/estado", { cache: "no-store" });
    if (!r.ok) return;
    const est = await r.json();
    if (!FIX) await garantirFix();
    render(est);
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
document.addEventListener("visibilitychange", () => { if (!document.hidden) ciclo(); });
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => EST && render(EST), 200); });
