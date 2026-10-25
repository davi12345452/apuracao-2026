"use strict";
// Pensado para o celular: mini-placar no topo, atalhos de seção e "desde a sua última olhada".
// Usa os helpers e o estado de app.js (EST, aba, brOk, MODELO, lider, liderTxt, fmtP, fmtN, esc…).
// app.js chama uxDepois(est) ao fim de cada render.

const UX = { heroFora: false, abaAtalhos: null, ativo: null, fixoH: 0, io: null, base: null, pendente: true, timer: 0 };
const UX_CHAVE = "ux-olhada", UX_MIN_MS = 2 * 60 * 1000, UX_AVISO_MS = 30 * 1000;

// ---------------------------------------------------------------- números da aba
function uxNumeros(est, escopo) {
  if (escopo === "brasil") {
    const n = est.nacional || {}, p = est.brasil?.modelos?.[MODELO];
    const apurando = est.fase === "apurando" && n.validos > 0;
    const uf = {};
    if (brOk()) for (const g of p.por_uf || []) if (g.grupo && g.apurado_pct != null) uf[g.grupo] = g.apurado_pct;
    return { ap: apurando ? n.apurado_pct : null, cont: apurando ? (100 * n.lula) / n.validos : null, proj: brOk() ? p.lula_pct : null, uf };
  }
  const x = est.exterior || {}, mu = x.mesmas_urnas || {}, p = x.modelos?.[MODELO];
  return { sec: x.secoes || 0, tot: x.secoes_tot || 0, cont: mu.validos ? (100 * mu.lula) / mu.validos : null,
    proj: p && p.disponivel && p.lula_pct != null ? p.lula_pct : null };
}

// ---------------------------------------------------------------- 1. mini-placar
const uxPct0 = (x) => fmtP(x, x < 10 ? 1 : 0);
function uxPlacar(est) {
  const k = (t) => `<span class="mp-k">${t === "Projeção" ? `<span class="mp-l">Projeção</span><span class="mp-c">Proj.</span>` : t}</span>`;
  if (aba === "brasil") {
    const b = uxNumeros(est, "brasil");
    if (b.ap == null) {
      const e = uxNumeros(est, "exterior");
      return `${k("Brasil")} às 17h` + (e.cont != null ? ` · ${k("Exterior")} ${lider(e.cont)} <span class="mp-s">· ${uxPct0((100 * e.sec) / e.tot)} das seções</span>` : "");
    }
    return `${k("Contado")} ${lider(b.cont)} · ${k("Projeção")} ${b.proj != null ? lider(b.proj) : "a partir de 5%"} · <span class="mp-ap">${uxPct0(b.ap)}<span class="mp-s"> apurado</span></span>`;
  }
  const e = uxNumeros(est, "exterior");
  if (e.cont == null) return `${k("Exterior")} nenhum boletim ainda`;
  return `${k("Contado")} ${lider(e.cont)} · ${k("Projeção")} ${e.proj != null ? lider(e.proj) : "a partir de 2%"} · <span class="mp-ap">${uxPct0(e.tot ? (100 * e.sec) / e.tot : 0)}<span class="mp-s"> das seções</span></span>`;
}
function uxAtualizarPlacar() {
  const topo = document.querySelector(".topo"), mp = $("ux-mp");
  const on = !!EST && UX.heroFora && (aba === "brasil" || aba === "exterior");
  if (on) mp.innerHTML = uxPlacar(EST);
  topo.classList.toggle("mp-on", on);
  mp.tabIndex = on ? 0 : -1;
  mp.setAttribute("aria-hidden", on ? "false" : "true");
}
function uxObservarHero() {
  UX.io?.disconnect();
  if (!("IntersectionObserver" in window)) return;
  UX.io = new IntersectionObserver((es) => {
    const e = es[es.length - 1];
    UX.heroFora = !e.isIntersecting && e.boundingClientRect.bottom <= UX.fixoH + 1;
    uxAtualizarPlacar();
  }, { rootMargin: `-${Math.round(UX.fixoH)}px 0px 0px 0px` });
  UX.io.observe($("hero"));
}

// ---------------------------------------------------------------- 2. atalhos de seção
function uxAlvos() {
  const ex = aba === "exterior";
  return [
    ["Resumo", $("hero")],
    ...(ex || !$("cmp") ? [] : [["Cresceu", $("cmp")]]), // cmp.js
    ["Mapa", document.querySelector(".mapa-card")],
    ["Por quê", $("porque")],
    ["O que falta", $("cascata").closest(".faixa-baixo")],
    [ex ? "Países" : "Estados", $("tabela").closest(".painel")],
    [ex ? "Boletins" : "Entradas", $("feed-painel")],
  ];
}
function uxMontarAtalhos() {
  const nav = $("atalhos"), mostrar = aba === "brasil" || aba === "exterior";
  if (nav.hidden === mostrar) nav.hidden = !mostrar;
  if (!mostrar || UX.abaAtalhos === aba) return;
  UX.abaAtalhos = aba; UX.ativo = null;
  nav.innerHTML = uxAlvos().map(([rot, el], i) => { el?.classList.add("ux-alvo"); return `<button type="button" data-ux-ir="${i}">${rot}</button>`; }).join("");
  uxMarcarAtivo();
}
function uxMarcarAtivo() {
  const nav = $("atalhos");
  if (nav.hidden) return;
  const alvos = uxAlvos(), linha = UX.fixoH + 16;
  let ativo = 0;
  alvos.forEach(([, el], i) => { if (el && el.offsetHeight && el.getBoundingClientRect().top <= linha) ativo = i; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) ativo = alvos.length - 1;
  if (ativo === UX.ativo) return;
  UX.ativo = ativo;
  nav.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-current", i === ativo ? "true" : "false"));
  const b = nav.children[ativo];
  if (b && nav.scrollWidth > nav.clientWidth) {
    const alvo = b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, alvo), behavior: "smooth" });
  }
}
function uxMedirFixo() {
  const topo = document.querySelector(".topo"), nav = $("atalhos");
  const th = topo.offsetHeight, h = th + (nav.hidden ? 0 : nav.offsetHeight);
  const raiz = document.documentElement.style;
  raiz.setProperty("--topo-h", th + "px");
  raiz.setProperty("--fixo-h", h + "px");
  if (Math.abs(h - UX.fixoH) > 1) { UX.fixoH = h; uxObservarHero(); }
}

// ---------------------------------------------------------------- 3. desde a sua última olhada
function uxLer() {
  try { const s = JSON.parse(localStorage.getItem(UX_CHAVE) || "null"); return s && typeof s.t === "number" ? s : null; } catch { return null; }
}
function uxSalvar(est) {
  try { localStorage.setItem(UX_CHAVE, JSON.stringify({ t: Date.now(), agora: est.agora, br: uxNumeros(est, "brasil"), ex: uxNumeros(est, "exterior") })); } catch {}
}
const uxLista = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);
function uxMudouTxt(nome, de, para, limiar) {
  if (para == null) return null;
  if (de == null) return `${nome}: ${liderTxt(para)}`;
  if (Math.abs(para - de) < limiar) return `${nome} mudou pouco (${liderTxt(para)})`;
  let d = 0;
  while (d < 2 && liderTxt(de, d) === liderTxt(para, d)) d++;
  return `${nome} foi de ${liderTxt(de, d)} para ${liderTxt(para, d)}`;
}
function uxDiffBrasil(a, b) {
  if (!b || a.ap == null) return [];
  const partes = [];
  if (b.ap == null) partes.push(`a apuração começou: ${fmtP(a.ap, 1)} apurado`);
  else if (a.ap - b.ap >= 0.1) partes.push(`${fmtPP(a.ap - b.ap, a.ap - b.ap < 10 ? 1 : 0)} apurado`);
  else return [];
  partes.push(uxMudouTxt("contado", b.cont, a.cont, 0.3), uxMudouTxt("projeção", b.proj, a.proj, 0.3));
  const passaram = Object.keys(a.uf || {}).filter((u) => u !== "zz" && a.uf[u] >= 90 && !((b.uf || {})[u] >= 90)).map((u) => u.toUpperCase());
  if (passaram.length) partes.push(passaram.length <= 3 ? `${uxLista(passaram)} ${passaram.length === 1 ? "passou" : "passaram"} de 90% apurado`
    : `${passaram.length} estados passaram de 90% apurado`);
  return partes.filter(Boolean);
}
function uxDiffExterior(a, b) {
  if (!b || !(a.sec > (b.sec || 0))) return [];
  const d = a.sec - (b.sec || 0);
  return [`+${fmtN(d)} ${d === 1 ? "seção" : "seções"} no exterior (${fmtN(a.sec)} de ${fmtN(a.tot)})`,
    uxMudouTxt("contado", b.cont, a.cont, 0.3), uxMudouTxt("projeção", b.proj, a.proj, 0.3)].filter(Boolean);
}
function uxMostrarAviso(base, est) {
  let partes;
  if (aba === "exterior") partes = uxDiffExterior(uxNumeros(est, "exterior"), base.ex);
  else {
    const br = uxNumeros(est, "brasil");
    partes = br.ap == null ? uxDiffExterior(uxNumeros(est, "exterior"), base.ex) : uxDiffBrasil(br, base.br);
  }
  if (!partes.length) return;
  let el = $("ux-olhada");
  if (!el) {
    el = document.createElement("div");
    el.id = "ux-olhada"; el.className = "olhada"; el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.innerHTML = `<p><b>Desde ${esc(fmtHora(base.t))}:</b> ${partes.map(esc).join(" · ")}</p><button type="button" class="olhada-x" aria-label="Fechar aviso">×</button>`;
  el.hidden = false;
  clearTimeout(UX.timer);
  UX.timer = setTimeout(uxFecharAviso, UX_AVISO_MS);
}
function uxFecharAviso() { const el = $("ux-olhada"); if (el) el.hidden = true; clearTimeout(UX.timer); }

// ---------------------------------------------------------------- gancho chamado por render()
function uxDepois(est) {
  uxMontarAtalhos();
  uxMedirFixo();
  uxAtualizarPlacar();
  requestAnimationFrame(uxMarcarAtivo);
  if (document.hidden) return; // só conta como "visto" o que esteve na tela
  if (UX.pendente) {
    const b = UX.base;
    // um render com o mesmo estado já salvo (resize, troca de aba) não conta: espera dado novo
    if (!b) UX.pendente = false;
    else if (b.agora !== est.agora) {
      UX.pendente = false;
      if (Date.now() - b.t >= UX_MIN_MS) uxMostrarAviso(b, est);
    }
  }
  uxSalvar(est);
}

// ---------------------------------------------------------------- início
(function uxInit() {
  const mp = document.createElement("button");
  mp.type = "button"; mp.id = "ux-mp"; mp.className = "mp"; mp.tabIndex = -1;
  mp.setAttribute("aria-hidden", "true"); mp.title = "Voltar ao resumo";
  document.querySelector(".topo .marca").appendChild(mp);
  mp.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
  UX.base = uxLer();
  document.addEventListener("click", (ev) => {
    const ir = ev.target.closest("[data-ux-ir]");
    if (ir) {
      const [, el] = uxAlvos()[+ir.dataset.uxIr] || [];
      if (!el) return;
      if (el.id === "hero") scrollTo({ top: 0, behavior: "smooth" });
      else el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (ev.target.closest(".olhada-x")) uxFecharAviso();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { UX.base = uxLer(); UX.pendente = true; }
  });
  addEventListener("pageshow", (ev) => { if (ev.persisted) { UX.base = uxLer(); UX.pendente = true; } });
  let raf = 0;
  addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; uxMarcarAtivo(); }); }, { passive: true });
  if ("ResizeObserver" in window) new ResizeObserver(uxMedirFixo).observe(document.querySelector(".topo"));
  uxMontarAtalhos();
  uxMedirFixo();
  if (EST) uxDepois(EST);
})();
