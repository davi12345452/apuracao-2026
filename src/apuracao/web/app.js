"use strict";

const POLL_MS = 10000;
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("pt-BR");
const fmtN = (x) => (x == null ? "—" : nf.format(Math.round(x)));
const fmtP = (x, d = 2) => (x == null || Number.isNaN(x) ? "—" : x.toFixed(d).replace(".", ",") + "%");
const fmtPP = (x) => (x == null ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(2).replace(".", ",") + " pp");
const sinal = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
const hora = (iso) => (iso ? iso.slice(11, 19) : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function kpi(k, v, d = "") {
  return `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ""}</div>`;
}

function placar(est) {
  const n = est.nacional;
  const apurando = n && n.secoes_apur > 0;
  let lula, flavio, validos, titulo, apurado, kp, aviso;
  if (apurando) {
    ({ lula, flavio, validos } = n);
    titulo = "Brasil · totalização oficial do TSE";
    apurado = `${fmtP(n.apurado_pct)} das seções · TSE ${n.hg}`;
    kp = [
      kpi("Comparecimento", fmtN(n.comparecimento), fmtP(100 - n.abstencao_pct) + " do eleitorado apurado"),
      kpi("Abstenção", fmtP(n.abstencao_pct), fmtN(n.abstencao) + " eleitores"),
      kpi("Brancos", fmtP(n.brancos_pct), fmtN(n.brancos)),
      kpi("Nulos", fmtP(n.nulos_pct), fmtN(n.nulos)),
      kpi("Seções", `${fmtN(n.secoes_apur)}`, `de ${fmtN(n.secoes_tot)}`),
    ];
    aviso = "";
  } else {
    const m = est.mesmas_urnas_exterior || {};
    lula = m.lula; flavio = m.flavio; validos = m.validos;
    titulo = "Exterior · somando os boletins de urna já publicados";
    const e = est.exterior || {};
    apurado = `${fmtN(e.secoes)} de ${fmtN(e.secoes_tot)} seções`;
    kp = [
      kpi("Comparecimento", fmtN(m.comparecimento), fmtN(m.eleitorado) + " aptos nessas seções"),
      kpi("Abstenção", fmtP(m.abstencao_pct), m["2026_1t"] ? "1º turno: " + fmtP(m["2026_1t"].abstencao_pct) : ""),
    ];
    aviso = "O TSE só divulga a totalização às 17h (Brasília). Até lá, o placar soma os boletins de urna das seções do exterior.";
  }
  $("placar-titulo").textContent = titulo;
  $("placar-apurado").textContent = apurado;
  const pl = validos ? (100 * lula) / validos : null;
  $("p-lula").textContent = fmtP(pl);
  $("p-flavio").textContent = fmtP(pl == null ? null : 100 - pl);
  $("v-lula").textContent = fmtN(lula) + " votos";
  $("v-flavio").textContent = fmtN(flavio) + " votos";
  $("b-lula").style.width = (pl ?? 50) + "%";
  $("kpis-placar").innerHTML = kp.join("");
  $("placar-aviso").textContent = aviso;
  const st = $("status");
  st.textContent = apurando ? `Apurando · ${fmtP(n.apurado_pct)}` : "Antes das 17h · só exterior";
  st.className = "pill" + (apurando ? " ao-vivo" : "");
}

function projCard(el, p, titulo, sub, extra = "") {
  if (!p || !p.disponivel || p.lula_pct == null) {
    const ap = p ? fmtP(100 * p.apurado_eleitorado) : "0%";
    el.innerHTML = `<h2>${titulo}</h2><div class="sub">${sub}</div><div class="indisp">Disponível a partir de 5% do eleitorado apurado (agora: ${ap}).</div>`;
    return;
  }
  const lo = Math.min(40, Math.floor(p.p10 - 1)), hi = Math.max(60, Math.ceil(p.p90 + 1));
  const x = (v) => (100 * (v - lo)) / (hi - lo);
  const alpha = p.alpha_regiao
    ? `<div class="sub" style="margin-top:10px">Dos votos dos outros candidatos do 1º turno, estimado para Lula: ${Object.entries(p.alpha_regiao)
        .map(([r, a]) => `${r} ${fmtP(a, 0)}`).join(" · ")}</div>`
    : "";
  el.innerHTML = `<h2>${titulo}</h2><div class="sub">${sub}</div>
    <div class="grande"><span class="pct" style="color:var(--lula)">Lula ${fmtP(p.lula_pct)}</span><span class="pct" style="color:var(--flavio)">${fmtP(p.flavio_pct)} Flávio</span></div>
    <div class="faixa" title="Faixa de 80% (p10–p90)">
      <div class="eixo"></div><div class="cinquenta" style="left:${x(50)}%"></div>
      <div class="int" style="left:${x(p.p10)}%;width:${x(p.p90) - x(p.p10)}%"></div>
      <div class="med" style="left:calc(${x(p.lula_pct)}% - 1px)"></div>
    </div>
    <div class="escala"><span>${lo}%</span><span class="e50" style="left:${x(50)}%">50%</span><span>${hi}%</span></div>
    <div class="linhas">
      <span>Faixa de 80% para Lula</span><span>${fmtP(p.p10)} a ${fmtP(p.p90)}</span>
      <span>Chance de Lula vencer</span><span>${fmtP(p.prob_lula, 0)}</span>
      <span>Margem projetada</span><span>${p.margem_votos >= 0 ? "Lula" : "Flávio"} por ${fmtN(Math.abs(p.margem_votos))} votos</span>
      <span>Abstenção projetada</span><span>${fmtP(p.abstencao_final_pct)}</span>
      <span>Válidos projetados</span><span>${fmtN(p.validos_final)}</span>
      <span>Eleitorado apurado</span><span>${fmtP(100 * p.apurado_eleitorado)}</span>
    </div>${alpha}${extra}`;
}

function tabelaMesmas(m, rotuloAtual = "2º turno 2026 (agora)") {
  if (!m || !m.validos) return `<div class="indisp">Ainda sem urnas apuradas.</div>`;
  const a = m, t1 = m["2026_1t"], v1 = m["2022_1t"], v2 = m["2022_2t"];
  const linha = (nome, lula, dir, outros, abst, nota = "") =>
    `<tr><td>${nome}</td><td>${fmtP(lula)}</td><td>${fmtP(dir)}</td><td>${outros == null ? "—" : fmtP(outros)}</td><td>${fmtP(abst)}</td><td>${nota}</td></tr>`;
  const dl = t1 ? a.lula - t1.lula : null, df = t1 ? a.flavio - t1.direita : null;
  return `<div class="tabela-wrap"><table>
    <tr><th></th><th>Lula</th><th>Flávio / Bolsonaro</th><th>Outros</th><th>Abstenção</th><th>Lula (só 2 primeiros)</th></tr>
    ${linha(rotuloAtual, a.lula_pct, 100 - a.lula_pct, null, a.abstencao_pct, fmtP(a.lula_pct))}
    ${t1 ? linha("1º turno 2026", t1.lula_pct, t1.direita_pct, 100 - t1.lula_pct - t1.direita_pct, t1.abstencao_pct, fmtP(t1.lula_2v_pct)) : ""}
    ${v2 ? linha("2º turno 2022", v2.lula_pct, v2.direita_pct, null, v2.abstencao_pct, fmtP(v2.lula_2v_pct)) : ""}
    ${v1 ? linha("1º turno 2022", v1.lula_pct, v1.direita_pct, 100 - v1.lula_pct - v1.direita_pct, v1.abstencao_pct, fmtP(v1.lula_2v_pct)) : ""}
  </table></div>
  <div class="kpis" style="margin-top:12px">
    ${kpi("Lula vs 1º turno", `<span class="${sinal(dl)}">${dl >= 0 ? "+" : "−"}${fmtN(Math.abs(dl))}</span>`, "votos nas mesmas urnas")}
    ${kpi("Flávio vs 1º turno", `<span class="${sinal(-df)}">${df >= 0 ? "+" : "−"}${fmtN(Math.abs(df))}</span>`, "votos nas mesmas urnas")}
    ${t1 ? kpi("Lula vs 1º turno", fmtPP(a.lula_pct - t1.lula_pct), "pontos percentuais dos válidos") : ""}
    ${v2 ? kpi("Lula vs 2º turno 2022", fmtPP(a.lula_pct - v2.lula_2v_pct), "pontos percentuais dos válidos") : ""}
    ${t1 ? kpi("Abstenção vs 1º turno", fmtPP(a.abstencao_pct - t1.abstencao_pct), "") : ""}
    ${v2 ? kpi("Abstenção vs 2º turno 2022", fmtPP(a.abstencao_pct - v2.abstencao_pct), "") : ""}
  </div>`;
}

// gráfico de linha único (Lula % dos válidos) com referência em 50% e tooltip
function linha(el, pontos, xKey, xLabel) {
  if (!pontos || pontos.length < 2) { el.style.height = "auto"; el.innerHTML = `<div class="vazio">Aguardando dados.</div>`; return; }
  el.style.height = "";
  const W = el.clientWidth || 600, H = el.clientHeight || 240, m = { l: 44, r: 12, t: 10, b: 26 };
  const xs = pontos.map((p, i) => (xKey ? p[xKey] : i));
  const ys = pontos.map((p) => p.lula_pct);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1;
  let y0 = Math.min(45, ...ys) - 1, y1 = Math.max(55, ...ys) + 1;
  y0 = Math.floor(y0); y1 = Math.ceil(y1);
  const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ticks = []; const passo = y1 - y0 > 30 ? 10 : 5;
  for (let v = Math.ceil(y0 / passo) * passo; v <= y1; v += passo) ticks.push(v);
  const d = pontos.map((p, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(p.lula_pct).toFixed(1)}`).join("");
  const ult = pontos[pontos.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lula entre os válidos">
    ${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}%</text>`).join("")}
    <line x1="${m.l}" x2="${W - m.r}" y1="${Y(50)}" y2="${Y(50)}" stroke="var(--ref)" stroke-dasharray="4 3"/>
    <text x="${W - m.r}" y="${Y(50) - 4}" text-anchor="end" font-size="11" fill="var(--muted)">50%</text>
    <path d="${d}" fill="none" stroke="var(--lula)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${X(xs[xs.length - 1])}" cy="${Y(ult.lula_pct)}" r="4" fill="var(--lula)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${m.l}" y="${H - 6}" font-size="11" fill="var(--muted)">${esc(xLabel(pontos[0], xs[0]))}</text>
    <text x="${W - m.r}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(xLabel(ult, xs[xs.length - 1]))}</text>
    <line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--ref)" visibility="hidden"/>
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>
  </svg>`;
  const svg = el.querySelector("svg"), cruz = svg.querySelector(".cruz"), tip = $("tooltip");
  svg.addEventListener("mousemove", (ev) => {
    const r = svg.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W;
    let best = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(X(xs[i]) - px) < Math.abs(X(xs[best]) - px)) best = i;
    const p = pontos[best]; cruz.setAttribute("x1", X(xs[best])); cruz.setAttribute("x2", X(xs[best])); cruz.setAttribute("visibility", "visible");
    tip.hidden = false; tip.style.left = ev.clientX + 12 + "px"; tip.style.top = ev.clientY + 12 + "px";
    tip.innerHTML = `${esc(xLabel(p, xs[best]))}<br>Lula <b>${fmtP(p.lula_pct)}</b> · Flávio <b>${fmtP(100 - p.lula_pct)}</b><br>${fmtN(p.lula)} × ${fmtN(p.flavio)}`;
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; cruz.setAttribute("visibility", "hidden"); });
}

function exterior(est) {
  const e = est.exterior; if (!e) return;
  const m = est.mesmas_urnas_exterior || {};
  const t1 = m["2026_1t"] || {}, v2 = m["2022_2t"] || {};
  $("ext-sub").textContent = `${fmtN(e.secoes)} de ${fmtN(e.secoes_tot)} seções com boletim`;
  $("kpis-ext").innerHTML = [
    kpi("Lula", fmtP(m.lula_pct), fmtN(m.lula) + " votos"),
    kpi("Flávio", fmtP(m.validos ? 100 - m.lula_pct : null), fmtN(m.flavio) + " votos"),
    kpi("Abstenção", fmtP(m.abstencao_pct), "1º turno " + fmtP(t1.abstencao_pct) + " · 2022 " + fmtP(v2.abstencao_pct)),
    kpi("Comparecimento", fmtN(m.comparecimento), "1º turno " + fmtN(t1.comparecimento) + " nas mesmas urnas"),
  ].join("");
  $("ext-mesmas").innerHTML = tabelaMesmas(m, "2º turno 2026 (exterior)");
  projCard($("ext-proj"), est.projecao_exterior, "Projeção do exterior completo", "Base: 1º turno 2026 por cidade, com transferência dos outros candidatos");
  linha($("ext-serie"), e.linha_tempo, null, (p) => `recebido ${hora(p.t)} · ${p.secoes} seções`);
  const rows = e.paises.filter((p) => p.secoes > 0);
  $("ext-tabela").innerHTML = `<tr><th>País</th><th>Seções</th><th>Lula</th><th>Flávio</th><th>Lula %</th><th>1º turno</th><th>Δ 1º turno</th><th>2022</th><th>Abstenção</th><th>Abst. 1º turno</th></tr>` +
    rows.map((p) => `<tr><td>${esc(p.pais)}</td><td>${p.secoes}/${p.secoes_tot}</td><td>${fmtN(p.lula)}</td><td>${fmtN(p.flavio)}</td>
      <td>${fmtP(p.lula_pct, 1)}<span class="mini"><i style="width:${p.lula_pct || 0}%"></i></span></td>
      <td>${fmtP(p.lula_1t_pct, 1)} × ${fmtP(p.flavio_1t_pct, 1)}</td>
      <td class="${sinal(p.lula_pct - p.lula_1t_pct)}">${p.lula_1t_pct == null ? "—" : fmtPP(p.lula_pct - p.lula_1t_pct)}</td>
      <td>${fmtP(p.lula_2022_pct, 1)}</td><td>${fmtP(p.abstencao_pct, 1)}</td><td>${fmtP(p.abstencao_1t_pct, 1)}</td></tr>`).join("");
}

function ufs(est) {
  const l = est.por_uf || [];
  $("uf-tabela").innerHTML = `<tr><th>UF</th><th>Região</th><th>Apurado</th><th>Lula agora</th><th>1º turno*</th><th>Δ</th><th>2022 2º turno</th><th>Δ</th><th>Abstenção</th><th>1º turno</th><th>2022</th></tr>` +
    l.map((u) => `<tr><td>${u.uf}</td><td>${u.regiao}</td><td>${fmtP(u.eleitorado_apur_pct, 1)}</td>
      <td>${fmtP(u.lula_pct, 1)}${u.lula_pct != null ? `<span class="mini"><i style="width:${u.lula_pct}%"></i></span>` : ""}</td>
      <td>${fmtP(u.lula_1t_pct, 1)}</td><td class="${sinal(u.lula_pct - u.lula_1t_pct)}">${u.lula_pct == null ? "—" : fmtPP(u.lula_pct - u.lula_1t_pct)}</td>
      <td>${fmtP(u.lula_2022_pct, 1)}</td><td class="${sinal(u.lula_pct - u.lula_2022_pct)}">${u.lula_pct == null ? "—" : fmtPP(u.lula_pct - u.lula_2022_pct)}</td>
      <td>${fmtP(u.abstencao_pct, 1)}</td><td>${fmtP(u.abstencao_1t_pct, 1)}</td><td>${fmtP(u.abstencao_2022_pct, 1)}</td></tr>`).join("") +
    `<tr><td colspan="11" class="muted" style="text-align:left">* 1º turno: fatia de Lula entre Lula e Flávio, nas mesmas urnas (sem os outros candidatos).</td></tr>`;
}

function render(est) {
  placar(est);
  const P = est.projecoes || {};
  projCard($("proj-2022"), P.vs_2022_2t, "Projeção pela base do 2º turno de 2022", "Variação de cada município em relação a 2022, aplicada ao que falta por UF");
  projCard($("proj-1t"), P.vs_2026_1t, "Projeção pela base do 1º turno de 2026", "Lula do 1º turno + parte estimada dos votos dos outros candidatos, por região");
  $("mesmas").innerHTML = tabelaMesmas(est.mesmas_urnas);
  linha($("serie"), est.serie_br, "apurado", (p) => `${fmtP(p.apurado)} apurado · ${p.hg}`);
  $("serie-sub").textContent = est.serie_br && est.serie_br.length ? `${est.serie_br.length} atualizações do TSE` : "começa às 17h";
  exterior(est);
  ufs(est);
  const c = est.coleta || {};
  $("coleta-sub").textContent = `BUs ${c.bu_secoes}/${c.secoes_ext} · municípios lidos ${c.municipios_lidos} · bases ${Object.entries(est.bases_ok || {}).map(([k, v]) => k + " " + v).join(", ")}`;
  $("eventos").innerHTML = (est.eventos || []).map((e) => `<li class="${e.nivel}">${hora(e.ts)} ${esc(e.nivel)} ${esc(e.msg)}</li>`).join("");
  $("atualizado").textContent = "atualizado " + hora(est.agora);
}

async function ciclo() {
  try {
    const r = await fetch("/api/estado", { cache: "no-store" });
    if (r.ok) render(await r.json());
  } catch (e) {
    $("atualizado").textContent = "falha ao ler o servidor local";
  }
}
ciclo();
setInterval(ciclo, POLL_MS);
