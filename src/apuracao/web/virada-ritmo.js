"use strict";
// "Virada possível?" e "Ritmo da apuração" (abas Brasil e Exterior).
// Usa os helpers de app.js (fmtP, fmtMi, fmtN, esc, comTip, ajuda, marca, MODELO, brOk).
// As contas ficam em funções puras (vrVirada, vrRitmo), testadas em tests/virada_ritmo.test.mjs.

// ---------------------------------------------------------------- contas
// contado: {lula, flavio}; grupos: [{validos_esperados, lula_esperado_pct}] do que ainda falta contar.
// Devolve quanto dos válidos que faltam quem está atrás no contado precisa para empatar.
function vrVirada(contado, grupos) {
  const L = +contado?.lula || 0, F = +contado?.flavio || 0;
  if (L + F <= 0) return { estado: "vazio" };
  let R = 0, LR = 0;
  for (const g of grupos || []) {
    const v = +g.validos_esperados || 0;
    if (v <= 0) continue;
    R += v; LR += (v * (+g.lula_esperado_pct || 0)) / 100;
  }
  if (L === F) return { estado: "empate", falta: R };
  const atras = L > F ? "f" : "l", dif = Math.abs(L - F);
  const tem = (100 * (atras === "l" ? L : F)) / (L + F);
  const espera = R > 0 ? 100 * (atras === "l" ? LR / R : 1 - LR / R) : null;
  if (R < 1) return { estado: "fim", atras, dif, tem, falta: 0 };
  const precisa = 50 + (50 * dif) / R; // atrás + x·R = frente + (1−x)·R
  return { estado: precisa > 100 ? "impossivel" : "possivel", atras, dif, tem, espera, precisa, falta: R };
}

// "17:21:00" → segundos; a série vira contínua se passar da meia-noite
function vrSegundos(hgs) {
  let dia = 0, ant = -1;
  return hgs.map((h) => {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(h || "");
    if (!m) return null;
    let s = +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) + dia;
    if (ant >= 0 && s < ant - 6 * 3600) { dia += 86400; s += 86400; }
    ant = s;
    return s;
  });
}
// "2026-10-25T17:21:05" → segundos (sem fuso: é a hora do TSE, de Brasília)
function vrSegIso(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/.exec(t || "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000 : null;
}
const vrHora = (s) => { const d = ((Math.round(s / 60) % 1440) + 1440) % 1440; return `${String(Math.floor(d / 60)).padStart(2, "0")}h${String(d % 60).padStart(2, "0")}`; };

// pts: [{s: segundos, ap: % apurado}] em ordem. Ritmo dos últimos `janela` segundos (cai para os 3 últimos pontos).
// agoraS (opcional, mesmo relógio): sem atualização há mais de 5 min, o ritmo cai em vez de congelar.
function vrRitmo(pts, janela = 1800, minPts = 3, agoraS = null) {
  let p = (pts || []).filter((x) => x && x.s != null && x.ap != null);
  if (p.length < minPts) return { estado: "cedo", n: p.length };
  const real = p[p.length - 1];
  if (real.ap >= 99.995) return { estado: "fim", ultimo: real, passou90: vrPassou(p, 90) };
  if (agoraS != null && agoraS - real.s > 300) p = [...p, { s: agoraS, ap: real.ap }];
  const u = p[p.length - 1];
  if (u !== real && real.s < u.s - janela) {
    return { estado: "parado", ultimo: real, semNovo: true, taxa10: 0, janelaMin: Math.round((u.s - real.s) / 60), passou90: vrPassou(p, 90) };
  }
  let ini = p.findIndex((x) => x.s >= u.s - janela);
  if (p.length - ini < 2 || u.s - p[ini].s < 120) ini = Math.max(0, p.length - 3);
  const a = p[ini], dt = u.s - a.s;
  if (dt <= 0) return { estado: "cedo", n: p.length };
  const taxa = (u.ap - a.ap) / dt; // pp por segundo
  const out = { estado: "ok", ultimo: real, semNovo: u !== real, taxa10: taxa * 600, janelaMin: Math.round(dt / 60), passou90: vrPassou(p, 90) };
  if (taxa <= 1e-9) return { ...out, estado: "parado" };
  if (u.ap < 90) {
    const falta = (90 - u.ap) / taxa;
    out.eta90 = falta <= 8 * 3600 ? u.s + falta : null; // longe demais vira "ritmo lento"
  }
  return out;
}
function vrPassou(p, alvo) {
  const i = p.findIndex((x) => x.ap >= alvo);
  if (i < 0) return null;
  if (i === 0) return p[0].s;
  const a = p[i - 1], b = p[i]; // interpola entre as duas leituras
  return a.s + ((alvo - a.ap) / (b.ap - a.ap || 1)) * (b.s - a.s);
}

// ---------------------------------------------------------------- texto
const VR_NOME = { l: "Lula", f: "Flávio" };
const VR_DICA_VIRADA = "Quanto dos votos válidos que ainda faltam quem está atrás no contado precisaria receber para empatar com quem está na frente. Conta só votos válidos (Lula + Flávio): brancos e nulos ficam de fora. O total que falta é uma estimativa da projeção, lugar por lugar, e muda a cada atualização. Para comparar: a parte que ele tem no contado e a que a projeção espera nos votos que faltam.";
function vrBlocoVirada(v, escopo, projOk, aguardando) {
  const tit = `<div class="vr-k">${comTip("Virada possível?", VR_DICA_VIRADA)}</div>`;
  const ext = escopo === "exterior" ? " no exterior" : "";
  if (!v || v.estado === "vazio") return `${tit}<p class="vr-vazio">${aguardando}</p>`;
  if (v.estado === "empate") return `${tit}<div class="vr-n">Empate</div><p class="vr-t">Os dois têm exatamente os mesmos votos no contado${ext}.</p>`;
  const nome = VR_NOME[v.atras], cls = v.atras;
  if (v.estado === "fim") return `${tit}<div class="vr-n">Contagem no fim</div><p class="vr-t">Quase não falta voto válido a contar${ext}; ${nome} está atrás por ${fmtMi(v.dif)}.</p>`;
  if (v.estado === "impossivel") {
    return `${tit}<div class="vr-n">${marca(cls)}${nome}: não dá mais</div>
      <p class="vr-t">Está ${fmtMi(v.dif)} votos atrás no contado${ext}, mais do que os ~${fmtMi(v.falta)} votos válidos que ainda faltam. Mesmo com todos eles, não empataria.</p>`;
  }
  const esp = projOk && v.espera != null;
  const alcanca = esp && v.espera >= v.precisa;
  const barra = `<div class="vr-barra" data-tip="${esc(`Parte dos votos válidos que faltam${ext}. Traço: o que ${nome} precisa (${fmtP(v.precisa)}). Barra: ${esp ? `o que a projeção espera para ele (${fmtP(v.espera)})` : `o que ele tem no contado (${fmtP(v.tem)})`}.`)}">
      <i class="vr-fill ${cls}" style="width:${Math.max(0, Math.min(100, esp ? v.espera : v.tem)).toFixed(1)}%"></i>
      <i class="vr-meio"></i><i class="vr-alvo" style="left:${Math.min(100, v.precisa).toFixed(1)}%"></i></div>`;
  return `${tit}<div class="vr-n"><b class="${cls}">${fmtP(v.precisa)}</b><span>dos ~${fmtMi(v.falta)} que faltam</span></div>
    <p class="vr-t">Para virar${ext}, ${marca(cls)}<b>${nome}</b> precisa disso. No contado tem <b>${fmtP(v.tem)}</b>${esp
      ? `; a projeção espera <b>${fmtP(v.espera)}</b> do que falta, ${alcanca ? "o bastante para virar" : "abaixo do necessário"}.`
      : ". A comparação com a projeção aparece quando ela estiver pronta."}</p>${barra}`;
}

const VR_DICA_RITMO = "Velocidade da contagem nos últimos minutos, medida pelas atualizações do TSE. A hora prevista só repete esse ritmo; ele costuma cair no fim, quando faltam as urnas mais demoradas, então a previsão tende a ser otimista.";
function vrBlocoRitmo(r, escopo, extra) {
  const tit = `<div class="vr-k">${comTip("Ritmo da apuração", VR_DICA_RITMO)}</div>`;
  if (!r || r.estado === "cedo") return `${tit}<p class="vr-vazio">Aparece depois das primeiras atualizações${escopo === "exterior" ? " do exterior" : " do TSE"}.</p>`;
  if (r.estado === "fim") return `${tit}<div class="vr-n"><b>100%</b><span>apurado</span></div><p class="vr-t">Contagem concluída às ${vrHora(r.ultimo.s)}.</p>`;
  const vel = escopo === "exterior" && extra?.secoes10 != null
    ? `<b>+${fmtN(extra.secoes10)}</b><span>seções a cada 10 min</span>`
    : `<b>+${(r.taxa10 >= 10 ? r.taxa10.toFixed(0) : r.taxa10.toFixed(1)).replace(".", ",")} pp</b><span>de apurado a cada 10 min</span>`;
  const jan = `nos últimos ${Math.max(1, r.janelaMin)} min`;
  const m = Math.max(1, r.janelaMin), dur = m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  if (r.estado === "parado") return `${tit}<div class="vr-n"><b>Parado</b><span>há ${dur}</span></div><p class="vr-t">${fmtP(r.ultimo.ap)} apurado desde ${vrHora(r.ultimo.s)}. ${escopo === "exterior" ? "As urnas do exterior fecham em horários diferentes." : "O TSE às vezes segura as atualizações por alguns minutos."}</p>`;
  if (escopo === "exterior") {
    const sem = r.semNovo ? `Sem boletim novo desde ${vrHora(r.ultimo.s)}. ` : "";
    return `${tit}<div class="vr-n">${vel}</div><p class="vr-t">${sem}Medido ${jan}. ${extra?.secoes != null ? `${fmtN(extra.secoes)} de ${fmtN(extra.tot)} seções (${fmtP(r.ultimo.ap, 0)}). ` : ""}Sem previsão de hora: as urnas fecham às 17h de cada país, e as da América do Norte fecham por último, já à noite no horário de Brasília.</p>`;
  }
  let p90;
  if (r.passou90 != null) p90 = `Passou de 90% às ${vrHora(r.passou90)}.`;
  else if (r.eta90 != null) p90 = `Nesse ritmo, 90% por volta das <b>${vrHora(Math.ceil(r.eta90 / 300) * 300)}</b>.`;
  else p90 = "Ritmo lento demais para prever a hora dos 90%.";
  const fim = "100% depende das últimas urnas, que costumam demorar.";
  const sem = r.semNovo ? `Sem atualização do TSE desde ${vrHora(r.ultimo.s)}. ` : "";
  return `${tit}<div class="vr-n">${vel}</div><p class="vr-t">${sem}Medido ${jan}. ${p90} ${fim}</p>`;
}

// ---------------------------------------------------------------- entrada (chamada por render() em app.js)
function renderViradaRitmo(est, escopo) {
  const el = document.getElementById("vr-bloco");
  if (!el) return;
  if (escopo !== "brasil" && escopo !== "exterior") { el.hidden = true; return; }
  el.hidden = false;
  try {
    let v = null, r = null, projOk = false, extra = null, aguardando;
    if (escopo === "brasil") {
      const p = est.brasil?.modelos?.[MODELO];
      const apurando = est.fase === "apurando";
      aguardando = apurando ? "Aparece junto com a estimativa do que falta." : "Aparece quando o TSE começar a divulgar, às 17h.";
      if (apurando && p?.contado && p.por_uf) v = vrVirada(p.contado, p.por_uf);
      projOk = brOk();
      const serie = apurando ? est.brasil?.serie || [] : [];
      const s = vrSegundos([...serie.map((x) => x.hg), (est.agora || "").slice(11, 19)]);
      r = vrRitmo(serie.map((x, i) => ({ s: s[i], ap: x.apurado })), 1800, 3, s[serie.length]);
    } else {
      const x = est.exterior || {}, p = x.modelos?.[MODELO];
      aguardando = x.secoes ? "Aparece junto com a estimativa do que falta." : "Aparece quando chegarem os primeiros boletins do exterior.";
      if (p?.contado && p.por_pais) v = vrVirada(p.contado, p.por_pais);
      projOk = !!(p && p.disponivel && p.lula_pct != null);
      const tot = x.secoes_tot || 0, h = x.hist || [];
      const pts = tot ? h.map((q) => ({ s: vrSegIso(q.t), ap: (100 * q.secoes) / tot, n: q.secoes })) : [];
      r = vrRitmo(pts, 3600, 3, vrSegIso(est.agora));
      extra = { secoes: x.secoes, tot, secoes10: r.taxa10 != null ? Math.round((r.taxa10 * tot) / 100) : null };
    }
    el.innerHTML = `<div class="vr-c">${vrBlocoVirada(v, escopo, projOk, aguardando)}</div><div class="vr-c">${vrBlocoRitmo(r, escopo, extra)}</div>`;
  } catch (e) {
    el.hidden = true; // indicador extra nunca derruba o resto do painel
  }
}

if (typeof module !== "undefined") module.exports = { vrVirada, vrRitmo, vrSegundos, vrSegIso, vrHora, vrPassou };
