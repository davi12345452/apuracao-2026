"use strict";
// ================================================================ quanto cada um cresceu: 2022 → 1º turno → agora
// Dados de /api/comparacao: somas por estado, nas mesmas urnas (fração apurada de cada município aplicada a
// 2022 e ao 1º turno). O filtro de estados e regiões soma os estados escolhidos aqui no navegador.
// Link compartilhável: ?cmp=sp,ba ou ?cmp=nordeste,sul (aceita siglas de estado e nomes de região).

const CMP = { dados: null, etag: null, lido: 0, carregando: false, sel: new Set(), aberto: false, chave: "" };
const CMP_REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul", "Exterior"];
const CMP_NOME_UF = { ac: "Acre", al: "Alagoas", am: "Amazonas", ap: "Amapá", ba: "Bahia", ce: "Ceará", df: "Distrito Federal",
  es: "Espírito Santo", go: "Goiás", ma: "Maranhão", mg: "Minas Gerais", ms: "Mato Grosso do Sul", mt: "Mato Grosso", pa: "Pará",
  pb: "Paraíba", pe: "Pernambuco", pi: "Piauí", pr: "Paraná", rj: "Rio de Janeiro", rn: "Rio Grande do Norte", ro: "Rondônia",
  rr: "Roraima", rs: "Rio Grande do Sul", sc: "Santa Catarina", se: "Sergipe", sp: "São Paulo", to: "Tocantins", zz: "Exterior" };
const CMP_POLL_MS = 30000;
const cmpSlug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-");
const cmpUfsDe = (reg) => Object.keys(REGIAO).filter((u) => REGIAO[u] === reg);

// ---------- seleção: um conjunto de siglas (minúsculas); vazio = Brasil (os 27 estados, sem o exterior)
function cmpLerSelecao() {
  let lista = null;
  try {
    const q = new URLSearchParams(location.search).get("cmp");
    if (q != null) lista = q.split(",");
  } catch {}
  if (lista == null) { try { lista = JSON.parse(ls.get("cmp-sel", "[]")); } catch { lista = []; } }
  const regs = Object.fromEntries(CMP_REGIOES.map((r) => [cmpSlug(r), r]));
  for (const x of Array.isArray(lista) ? lista : []) {
    const k = cmpSlug(String(x).trim());
    if (regs[k]) cmpUfsDe(regs[k]).forEach((u) => CMP.sel.add(u));
    else if (k === "ext") CMP.sel.add("zz");
    else if (REGIAO[k]) CMP.sel.add(k);
  }
}
function cmpGuardar() { ls.set("cmp-sel", JSON.stringify([...CMP.sel])); }
function cmpEscolhidos() {
  if (!CMP.sel.size) return Object.keys(REGIAO).filter((u) => u !== "zz");
  return [...CMP.sel];
}
// nome curto da seleção: regiões inteiras pelo nome, o resto pela sigla
function cmpNomeSel() {
  if (!CMP.sel.size) return "Brasil";
  const partes = [], resto = new Set(CMP.sel);
  for (const r of CMP_REGIOES) {
    const us = cmpUfsDe(r);
    if (us.every((u) => resto.has(u))) { partes.push(r); us.forEach((u) => resto.delete(u)); }
  }
  if (partes.length === 6) return "Brasil e exterior";
  if (partes.length === 5 && !CMP.sel.has("zz")) return "Brasil";
  const ufs = [...resto].sort().map((u) => u.toUpperCase());
  if (partes.length + ufs.length === 1 && ufs.length === 1) return CMP_NOME_UF[ufs[0].toLowerCase()] || ufs[0];
  const ext = partes.includes("Exterior") ? ["Exterior"] : [];
  return [...partes.filter((p) => p !== "Exterior"), ...ufs, ...ext].join(" + ");
}

// ---------- soma dos estados escolhidos
const CMP_I = { est: 0, lula: 1, flavio: 2, comp: 3, l22: 4, b22: 5, c22: 6, a22: 7, l1: 8, f1: 9, o1: 10, c1: 11 };
function cmpSomar(vetores, idx) {
  const s = new Array(12).fill(0);
  for (const g of idx) { const v = vetores[g]; if (v) for (let k = 0; k < 12; k++) s[k] += v[k]; }
  return s;
}
const cmpPct = (a, b) => (b > 0 ? (100 * a) / b : null);
function cmpMetricas(s, te) {
  const I = CMP_I, v2 = s[I.lula] + s[I.flavio], v22 = s[I.l22] + s[I.b22], v1 = s[I.l1] + s[I.f1] + s[I.o1];
  return {
    apurado: cmpPct(s[I.est], te), est: s[I.est],
    agora: { l: cmpPct(s[I.lula], v2), f: cmpPct(s[I.flavio], v2), vl: s[I.lula], vf: s[I.flavio], comp: s[I.comp] },
    t22: { l: cmpPct(s[I.l22], v22), f: cmpPct(s[I.b22], v22), vl: s[I.l22], vf: s[I.b22], comp: s[I.c22], aptos: s[I.a22] },
    t1: { l: cmpPct(s[I.l1], v1), f: cmpPct(s[I.f1], v1), o: cmpPct(s[I.o1], v1), vl: s[I.l1], vf: s[I.f1], vo: s[I.o1], comp: s[I.c1] },
  };
}
// curva: carrega cada estado para a frente e soma a seleção em cada ponto; "agora" fecha a curva
function cmpCurva(d, idx, te, agoraM, rotAgora) {
  const estado = {}, pts = [];
  let ultEst = -1;
  for (const [t, linhas] of d.serie || []) {
    // [estado, eleitores, Lula, Flávio, Lula 22, Bolsonaro 22, Lula 1t, Flávio 1t, 3ª via 1t] → vetor de 12
    for (const l of linhas) estado[l[0]] = [l[1], l[2], l[3], 0, l[4], l[5], 0, 0, l[6], l[7], l[8], 0];
    const s = cmpSomar(estado, idx);
    if (s[CMP_I.est] <= 0 || s[CMP_I.est] === ultEst) continue;
    ultEst = s[CMP_I.est];
    pts.push({ t, ...cmpMetricas(s, te) });
  }
  if (agoraM.est > 0 && agoraM.est !== ultEst) pts.push({ t: rotAgora, ...agoraM });
  else if (pts.length && agoraM.est > 0) pts[pts.length - 1] = { t: pts[pts.length - 1].t, ...agoraM };
  return pts;
}

// ---------- formatos
const cmpPP = (d) => (d == null ? "—" : Math.abs(d) < 0.05 ? "0,0 pp" : (d > 0 ? "+" : "−") + Math.abs(d).toFixed(1).replace(".", ",") + " pp");
const cmpVotos = (d) => (d == null ? "—" : Math.abs(d) < 0.5 ? "0" : (d > 0 ? "+" : "−") + fmtMi(Math.abs(d)));
const cmpDif = (a, b) => (a == null || b == null ? null : a - b);

// ---------- filtros
function cmpFiltros(apurado) {
  const sel = CMP.sel;
  const chipsReg = CMP_REGIOES.map((r) => {
    const us = cmpUfsDe(r), n = us.filter((u) => sel.has(u)).length;
    const on = n === us.length, parcial = n > 0 && !on;
    return `<button class="cmp-chip${parcial ? " parcial" : ""}" data-cmp-reg="${esc(r)}" aria-pressed="${on}">${esc(r)}${parcial ? ` <small>${n}/${us.length}</small>` : ""}</button>`;
  }).join("");
  const nUf = [...sel].filter((u) => u !== "zz").length;
  const grade = CMP_REGIOES.filter((r) => r !== "Exterior").map((r) => `<div class="cmp-grupo"><span class="cmp-grupo-n">${esc(r)}</span><div class="cmp-ufs">${
    cmpUfsDe(r).sort().map((u) => `<button class="cmp-chip cmp-uf" data-cmp-uf="${esc(u)}" aria-pressed="${sel.has(u)}" title="${esc(CMP_NOME_UF[u])}">${esc(u.toUpperCase())}</button>`).join("")}</div></div>`).join("");
  return `<div class="cmp-filtros">
    <div class="cmp-atual"><span class="cmp-atual-t">Comparando <b>${esc(cmpNomeSel())}</b>${apurado != null ? ` · ${fmtP(apurado, apurado < 10 ? 1 : 0)} do eleitorado apurado` : ""}</span>
      ${sel.size ? `<button class="cmp-limpar" data-cmp-limpar>Limpar</button>` : ""}</div>
    <div class="cmp-regs" role="group" aria-label="Regiões">${chipsReg}
      <button class="cmp-chip cmp-abre" data-cmp-abre aria-expanded="${CMP.aberto}">Estados${nUf ? ` <small>${nUf}</small>` : ""} <span aria-hidden="true">${CMP.aberto ? "▴" : "▾"}</span></button></div>
    ${CMP.aberto ? `<div class="cmp-painel-ufs" role="group" aria-label="Estados">${grade}<p class="cmp-dica">Toque para somar ou tirar. Regiões e estados se combinam.</p></div>` : ""}
  </div>`;
}

// ---------- tabela-resumo: 2022, 1º turno e agora; e quanto cada um cresceu
function cmpResumo(m, final) {
  const a = m.agora, t22 = m.t22, t1 = m.t1, comAgora = a.l != null;
  const cel = (p, v) => `<b>${fmtP(p)}</b><small>${v == null ? "" : fmtMi(v)}</small>`;
  const tab = `<table class="cmp-tab"><thead><tr><th></th>
      <th>${comTip("2022", "2º turno de 2022, Lula × Jair Bolsonaro. Percentual dos votos válidos.")}</th>
      <th>${comTip("1º turno", "1º turno de 2026, sobre TODOS os votos válidos: a 3ª via fica no denominador, por isso os dois somam menos de 100%.")}</th>
      <th>${comTip("Agora", "2º turno de 2026, só o que já foi contado.")}</th></tr></thead><tbody>
    <tr><th scope="row">${marca("l")}Lula</th><td>${cel(t22.l, t22.vl)}</td><td>${cel(t1.l, t1.vl)}</td><td>${comAgora ? cel(a.l, a.vl) : "—"}</td></tr>
    <tr><th scope="row">${marca("f")}Flávio<small>2022: Bolsonaro</small></th><td>${cel(t22.f, t22.vf)}</td><td>${cel(t1.f, t1.vf)}</td><td>${comAgora ? cel(a.f, a.vf) : "—"}</td></tr>
    <tr class="cmp-3via"><th scope="row">3ª via</th><td class="muted">—</td><td>${cel(t1.o, t1.vo)}</td><td class="muted">—</td></tr>
  </tbody></table>`;
  if (!comAgora) return tab;
  const linha = (c, nome, p, v) => `<tr><th scope="row">${marca(c)}${nome}</th>
    <td><b>${cmpPP(cmpDif(p, t22[c]))}</b><small>${cmpVotos(cmpDif(v, t22["v" + c]))} votos</small></td>
    <td><b>${cmpPP(cmpDif(p, t1[c]))}</b><small>${cmpVotos(cmpDif(v, t1["v" + c]))} votos</small></td></tr>`;
  const cresc = `<table class="cmp-tab cmp-cresc"><thead><tr><th>Cresceu</th>
      <th>${comTip("desde 2022", "Diferença para o 2º turno de 2022 nas mesmas urnas. Flávio é comparado com Bolsonaro. Em votos: quantos a mais (ou a menos) que o candidato do mesmo lado teve nesses lugares.")}</th>
      <th>${comTip("desde o 1º turno", "Diferença para o 1º turno de 2026 nas mesmas urnas, com a 3ª via contada no 1º turno. Quase todo o crescimento de pontos vem dos votos da 3ª via que se dividiram entre os dois.")}</th></tr></thead><tbody>
    ${linha("l", "Lula", a.l, a.vl)}${linha("f", "Flávio", a.f, a.vf)}</tbody></table>`;
  const comp = `<p class="cmp-comp">${comTip("Foram votar", "Comparecimento nas mesmas urnas. O número de eleitores muda de uma eleição para outra, então o crescimento em votos também depende de quanta gente votou.")}: <b>${fmtMi(a.comp)}</b> agora · ${fmtMi(t22.comp)} em 2022 · ${fmtMi(t1.comp)} no 1º turno.</p>`;
  return tab + cresc + comp;
}

// ---------- gráfico: um por candidato, mesma escala; linhas de 2px; rótulos diretos na ponta
// "agora" é desenhada primeiro: as tracejadas ficam visíveis por cima quando coincidem
const CMP_LINHAS = [
  { k: "agora", nome: "Agora", dash: "" },
  { k: "t1", nome: "1º turno", dash: "7 4" },
  { k: "t22", nome: "2022", dash: "1.5 4" },
];
function cmpGrafico(pts, c, d0) {
  const dom = { ...d0, ...d0.y[c] };
  const W = Math.max(260, dom.w), H = matchMedia("(max-width: 760px)").matches ? 190 : 210, m = { l: 34, r: 92, t: 10, b: 24 };
  const X = (v) => m.l + ((v - dom.x0) / (dom.x1 - dom.x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - dom.y0) / (dom.y1 - dom.y0 || 1)) * (H - m.t - m.b);
  const cor = c === "l" ? "var(--lula)" : "var(--flavio)";
  let s = `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="${c === "l" ? "Lula" : "Flávio"}: agora, 1º turno e 2022 ao longo da apuração">`;
  for (const v of dom.ticks) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}%</text>`;
  for (const v of dom.xticks) s += `<text x="${X(v)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${v}%</text>`;
  const rot = [];
  for (const L of CMP_LINHAS) {
    const ps = pts.filter((p) => p[L.k][c] != null);
    if (!ps.length) continue;
    const d = ps.map((p, i) => `${i ? "L" : "M"}${X(p.apurado).toFixed(1)},${Y(p[L.k][c]).toFixed(1)}`).join("");
    s += `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${L.dash ? `stroke-dasharray="${L.dash}"` : ""} ${L.k === "agora" ? "" : 'opacity=".8"'}/>`;
    const u = ps[ps.length - 1], u0 = u;
    if (ps.length === 1 && L.k !== "agora") s += `<circle cx="${X(u0.apurado)}" cy="${Y(u0[L.k][c])}" r="3" fill="${cor}" opacity=".8"/>`;
    if (L.k === "agora") s += `<circle cx="${X(u.apurado)}" cy="${Y(u[L.k][c])}" r="4" fill="${cor}" stroke="var(--surface)" stroke-width="2"/>`;
    rot.push({ x: X(u.apurado), y: Y(u[L.k][c]), t: `${L.nome} ${fmtP(u[L.k][c])}`, forte: L.k === "agora" });
  }
  rot.sort((a, b) => a.y - b.y || (b.forte ? 1 : 0) - (a.forte ? 1 : 0));
  for (let i = 1; i < rot.length; i++) if (rot[i].y - rot[i - 1].y < 14) rot[i].y = rot[i - 1].y + 14;
  const passou = rot.length ? rot[rot.length - 1].y - (H - m.b) : 0;
  if (passou > 0) rot.forEach((r) => (r.y -= passou));
  for (const r of rot) s += `<text x="${r.x + 8}" y="${r.y + 4}" font-size="11" ${r.forte ? 'font-weight="700"' : ""} fill="var(--text)">${esc(r.t)}</text>`;
  s += `<line class="cmp-cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--ref)" visibility="hidden"/>`;
  s += `<rect class="cmp-alvo" x="${m.l}" y="0" width="${W - m.l - m.r + 40}" height="${H}" fill="transparent"/></svg>`;
  return { svg: s, X };
}
// cada candidato tem a própria faixa do eixo, mas as duas com a MESMA altura em pp:
// um ponto de crescimento ocupa o mesmo espaço nos dois gráficos
function cmpDominio(pts, w) {
  const faixa = {};
  for (const c of ["l", "f"]) {
    const ys = [];
    for (const p of pts) for (const L of CMP_LINHAS) if (p[L.k][c] != null) ys.push(p[L.k][c]);
    faixa[c] = [Math.min(...ys), Math.max(...ys)];
  }
  const span0 = Math.max(faixa.l[1] - faixa.l[0], faixa.f[1] - faixa.f[0]) + 2;
  const passo = [1, 2, 5, 10, 20].find((p) => span0 / p <= 5) || 25;
  const span = Math.ceil(span0 / passo) * passo + passo;
  const y = {};
  for (const c of ["l", "f"]) {
    const meio = (faixa[c][0] + faixa[c][1]) / 2;
    let y0 = Math.floor((meio - span / 2) / passo) * passo;
    if (y0 + span < faixa[c][1] + 0.5) y0 += passo;
    y0 = Math.max(0, Math.min(100 - span, y0));
    const ticks = []; for (let v = y0; v <= y0 + span + 1e-9; v += passo) ticks.push(v);
    y[c] = { y0, y1: y0 + span, ticks };
  }
  const xm = Math.max(...pts.map((p) => p.apurado));
  const xp = xm <= 20 ? 5 : xm <= 50 ? 10 : 25;
  const x1 = Math.min(100, Math.max(10, Math.ceil(xm / xp) * xp));
  const xticks = []; for (let v = 0; v <= x1 + 1e-9; v += xp) xticks.push(v);
  return { x0: 0, x1, y, xticks, w };
}
function cmpTip(p, c) {
  const n = c === "l" ? "Lula" : "Flávio", n22 = c === "l" ? "Lula" : "Bolsonaro";
  return `<div class="tt-s">${esc(p.t)} · ${fmtP(p.apurado)} apurado</div><div class="tt-g">
    <span>${n} agora</span><span>${fmtP(p.agora[c])}</span>
    <span>${n} no 1º turno</span><span>${fmtP(p.t1[c])}</span>
    <span>${n22} em 2022</span><span>${fmtP(p.t22[c])}</span>
    <span>desde 2022</span><span>${cmpPP(cmpDif(p.agora[c], p.t22[c]))}</span>
    <span>desde o 1º turno</span><span>${cmpPP(cmpDif(p.agora[c], p.t1[c]))}</span></div>`;
}
function cmpLigarGrafico(el, pts, c, X) {
  const sv = el.querySelector("svg"), cruz = sv.querySelector(".cmp-cruz"), tip = $("tooltip");
  const mover = (ev) => {
    const r = sv.getBoundingClientRect(), vb = sv.viewBox.baseVal.width, px = ((ev.clientX - r.left) / r.width) * vb;
    let bi = 0; for (let i = 1; i < pts.length; i++) if (Math.abs(X(pts[i].apurado) - px) < Math.abs(X(pts[bi].apurado) - px)) bi = i;
    const x = X(pts[bi].apurado); cruz.setAttribute("x1", x); cruz.setAttribute("x2", x); cruz.setAttribute("visibility", "visible");
    tooltip(ev, cmpTip(pts[bi], c));
  };
  const sair = () => { tip.hidden = true; cruz.setAttribute("visibility", "hidden"); };
  sv.addEventListener("pointermove", mover);
  sv.addEventListener("pointerdown", mover);
  sv.addEventListener("pointerleave", sair);
  sv.addEventListener("pointercancel", sair);
}
function cmpLegenda() {
  return `<div class="cmp-leg">${CMP_LINHAS.map((L) => `<span><svg width="26" height="8" aria-hidden="true"><line x1="1" x2="25" y1="4" y2="4" stroke="var(--text-2)" stroke-width="2" stroke-linecap="round" ${L.dash ? `stroke-dasharray="${L.dash}"` : ""}/></svg>${L.k === "agora" ? "2º turno agora" : L.k === "t1" ? "1º turno 2026" : "2º turno 2022"}</span>`).join("")}</div>`;
}

// ---------- montagem
function cmpMontar(el, est) {
  const d = CMP.dados;
  if (!d || !d.ufs) {
    el.innerHTML = `<header><h2>Quanto cada um cresceu</h2></header><div class="vazio">${CMP.carregando ? "Carregando a comparação…" : "A comparação ainda não está disponível. Nova tentativa em instantes."}</div>`;
    return;
  }
  const escolhidos = cmpEscolhidos(), idx = escolhidos.map((u) => d.ufs.indexOf(u)).filter((g) => g >= 0);
  const te = idx.reduce((a, g) => a + (d.eleitorado[g] || 0), 0);
  const m = cmpMetricas(cmpSomar(d.agora, idx), te);
  const tem = m.est > 0;
  let corpo;
  if (!tem) {
    const f22 = idx.reduce((a, g) => a.map((x, k) => x + d.final_2022[g][k]), [0, 0, 0, 0]);
    const f1 = idx.reduce((a, g) => a.map((x, k) => x + d.final_1t[g][k]), [0, 0, 0, 0, 0]);
    const v22 = f22[0] + f22[1], v1 = f1[0] + f1[1] + f1[2];
    const ref = { apurado: 0, est: 0, agora: {}, t22: { l: cmpPct(f22[0], v22), f: cmpPct(f22[1], v22), vl: f22[0], vf: f22[1] },
      t1: { l: cmpPct(f1[0], v1), f: cmpPct(f1[1], v1), o: cmpPct(f1[2], v1), vl: f1[0], vf: f1[1], vo: f1[2] } };
    const soExt = escolhidos.length === 1 && escolhidos[0] === "zz";
    corpo = `<div class="cmp-vazio"><b>Ainda não há votos contados ${soExt ? "no exterior" : cmpNomeSel() === "Brasil" ? "no Brasil" : `em ${esc(cmpNomeSel())}`}.</b> ${soExt ? "Os boletins do exterior entram ao longo do dia." : "A apuração do Brasil começa às 17h (horário de Brasília)."}
      Quando as primeiras urnas entrarem, esta parte mostra, nas mesmas urnas, quanto Lula e Flávio têm a mais ou a menos que em 2022 e no 1º turno, e a curva ao longo da noite.${!CMP.sel.has("zz") && (d.agora[d.ufs.indexOf("zz")]?.[0] || 0) > 0 ? ` O exterior já tem votos: toque em <b>Exterior</b> para ver.` : ""}</div>
      <p class="cmp-sub">Enquanto isso, o resultado completo nesses lugares:</p>${cmpResumo(ref)}`;
  } else {
    const pts = cmpCurva(d, idx, te, m, est?.nacional?.hg ? est.nacional.hg.slice(0, 5) : "agora");
    const w = Math.min(560, (el.clientWidth || 360) - (matchMedia("(max-width: 760px)").matches ? 32 : 40));
    const largo = matchMedia("(min-width: 1101px)").matches;
    const wg = largo ? Math.floor(((el.clientWidth || 1200) - 40) * 0.55 / 2) - 10 : w;
    const dom = cmpDominio(pts, wg);
    const gl = cmpGrafico(pts, "l", dom), gf = cmpGrafico(pts, "f", dom);
    CMP._graf = [{ pts, c: "l", X: gl.X }, { pts, c: "f", X: gf.X }];
    corpo = `<div class="cmp-grade">
      <div class="cmp-esq">${cmpResumo(m)}</div>
      <div class="cmp-dir">
        <p class="cmp-sub">${comTip("A curva da noite", "Cada ponto é a apuração naquele momento. As linhas tracejada e pontilhada mostram o que as MESMAS urnas deram no 1º turno e em 2022: a distância até a linha cheia é quanto cada um cresceu.")}. Embaixo, quanto do eleitorado escolhido já foi apurado.</p>
        <div class="cmp-graficos">
          <figure class="cmp-g"><figcaption>${marca("l")}Lula</figcaption><div class="cmp-svg" data-cmp-g="0">${gl.svg}</div></figure>
          <figure class="cmp-g"><figcaption>${marca("f")}Flávio <small>(2022: Bolsonaro)</small></figcaption><div class="cmp-svg" data-cmp-g="1">${gf.svg}</div></figure>
        </div>
        ${cmpLegenda()}
      </div></div>`;
  }
  el.innerHTML = `<header><h2>Quanto cada um cresceu ${ajuda("Lula e Flávio agora, comparados com 2022 (Lula × Bolsonaro) e com o 1º turno de 2026 nas MESMAS urnas: cada município entra na proporção que já foi apurada. No 1º turno o percentual é sobre todos os válidos, com a 3ª via.")}</h2>
      <p>2022 → 1º turno → agora, nas mesmas urnas</p></header>
    ${cmpFiltros(tem ? m.apurado : null)}${corpo}
    <p class="nota-leitura">${tem ? "Mesmas urnas: em cada município, a parte já apurada agora é comparada com a mesma parte do resultado dele em 2022 e no 1º turno. " : ""}No 1º turno, os percentuais são sobre todos os votos válidos, com a 3ª via no denominador; em 2022 e agora, só há dois candidatos.${CMP.sel.has("zz") ? " Exterior: boletins de urna ao longo do dia e, depois, a totalização oficial, cidade a cidade." : ""}</p>`;
  if (tem) el.querySelectorAll("[data-cmp-g]").forEach((g) => { const o = CMP._graf[+g.dataset.cmpG]; cmpLigarGrafico(g, o.pts, o.c, o.X); });
}

async function cmpBuscar() {
  if (CMP.carregando) return;
  CMP.carregando = true;
  try {
    const r = await fetch("/api/comparacao", { headers: CMP.etag ? { "If-None-Match": CMP.etag } : {} });
    CMP.lido = Date.now();
    if (r.status === 200) { CMP.dados = await r.json(); CMP.etag = r.headers.get("ETag"); CMP.chave = ""; }
  } catch {} finally { CMP.carregando = false; }
}

function cmpRender(est, abaAtual) {
  const el = $("cmp");
  if (!el) return;
  el.hidden = abaAtual !== "brasil";
  if (el.hidden) return;
  const desenhar = () => {
    const chave = [CMP.etag, [...CMP.sel].sort().join(","), CMP.aberto, el.clientWidth, est?.nacional?.hg, !!CMP.dados].join("|");
    if (chave === CMP.chave) return;
    CMP.chave = chave;
    try { cmpMontar(el, est); } catch (e) {
      console.error("comparação:", e);
      el.innerHTML = `<header><h2>Quanto cada um cresceu</h2></header><div class="vazio">A comparação não pôde ser montada agora. Nova tentativa na próxima atualização.</div>`;
    }
  };
  desenhar();
  if (!CMP.dados || Date.now() - CMP.lido > CMP_POLL_MS) cmpBuscar().then(desenhar);
}

function cmpInit() {
  cmpLerSelecao();
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-cmp-reg],[data-cmp-uf],[data-cmp-abre],[data-cmp-limpar]");
    if (!el) return;
    if (el.dataset.cmpReg) {
      const us = cmpUfsDe(el.dataset.cmpReg), todos = us.every((u) => CMP.sel.has(u));
      us.forEach((u) => (todos ? CMP.sel.delete(u) : CMP.sel.add(u)));
    } else if (el.dataset.cmpUf) {
      const u = el.dataset.cmpUf;
      if (CMP.sel.has(u)) CMP.sel.delete(u); else CMP.sel.add(u);
    } else if (el.hasAttribute("data-cmp-abre")) {
      CMP.aberto = !CMP.aberto;
    } else {
      CMP.sel.clear();
    }
    cmpGuardar();
    CMP.chave = "";
    if (typeof EST !== "undefined" && EST) cmpRender(EST, aba);
    // mantém o foco no mesmo botão depois de redesenhar (teclado)
    const sel = el.dataset.cmpReg ? `[data-cmp-reg="${el.dataset.cmpReg}"]` : el.dataset.cmpUf ? `[data-cmp-uf="${el.dataset.cmpUf}"]` : el.hasAttribute("data-cmp-abre") ? "[data-cmp-abre]" : null;
    if (sel && ev.detail === 0) document.querySelector(sel)?.focus();
  });
}
cmpInit();
