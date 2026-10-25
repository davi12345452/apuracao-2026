"""Avisos no Telegram nos marcos da noite (opcionais).

Cada aviso tem uma chave e sai uma vez só (tabela alerta). Viradas usam o último lado avisado
(tabela alerta_estado). O token vem de APURACAO_TG_TOKEN ou da config do OpenClaw; o chat, de
APURACAO_TG_CHAT ou data/alertas.json. Nada disso vai para o repositório.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from .db import DB

DATA = Path(__file__).resolve().parents[2] / "data"
MODELO = "vs_2026_1t"
MARCOS_APURADO = (10, 25, 50, 75, 90, 99)
LIMIARES_CHANCE = (90, 95, 99)
MOV_MERCADO_PP = 5.0  # chance média dos mercados andando isso em 30 min


def _config() -> tuple[str | None, str | None]:
    token = os.environ.get("APURACAO_TG_TOKEN")
    if not token:
        try:
            cfg = json.loads(Path("~/.openclaw/openclaw.json").expanduser().read_text())
            token = cfg["channels"]["telegram"]["botToken"]
        except Exception:  # noqa: BLE001 - sem token, sem aviso
            token = None
    chat = os.environ.get("APURACAO_TG_CHAT")
    if not chat:
        try:
            chat = str(json.loads((DATA / "alertas.json").read_text())["chat_id"])
        except Exception:  # noqa: BLE001
            chat = None
    return token, chat


def enviar(texto: str) -> bool:
    token, chat = _config()
    if not token or not chat:
        return False
    corpo = urllib.parse.urlencode({"chat_id": chat, "text": texto, "disable_web_page_preview": "true"}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=corpo)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read()).get("ok", False)


def _preparar(db: DB) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS alerta (chave TEXT PRIMARY KEY, ts TEXT, msg TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS alerta_estado (chave TEXT PRIMARY KEY, valor TEXT)")


def _ja(db: DB, chave: str) -> bool:
    return bool(db.query("SELECT 1 FROM alerta WHERE chave=?", (chave,)))


def _avisar(db: DB, chave: str, msg: str) -> None:
    if _ja(db, chave):
        return
    try:
        ok = enviar(msg)
    except Exception as e:  # noqa: BLE001 - tenta de novo no próximo ciclo
        db.log("aviso", f"telegram {chave}: {e!r}")
        return
    if ok:
        db.execute("INSERT OR REPLACE INTO alerta VALUES (?,?,?)", (chave, datetime.now().isoformat(timespec="seconds"), msg))


def _estado(db: DB, chave: str) -> str | None:
    r = db.query("SELECT valor FROM alerta_estado WHERE chave=?", (chave,))
    return r[0]["valor"] if r else None


def _guardar(db: DB, chave: str, valor: str) -> None:
    db.execute("INSERT OR REPLACE INTO alerta_estado VALUES (?,?)", (chave, valor))


def _pct(x: float | None, d: int = 1) -> str:
    return "—" if x is None else f"{x:.{d}f}".replace(".", ",") + "%"


def _votos(v: float) -> str:
    v = abs(v)
    return f"{v / 1e6:.2f} mi".replace(".", ",") if v >= 1e6 else f"{v / 1e3:.0f} mil"


def _lider(pl: float | None, d: int = 1) -> str:
    """Placar pelo nome de quem lidera (pl: % de Lula entre os dois)."""
    if pl is None:
        return "—"
    return f"Lula {_pct(pl, d)}" if pl >= 50 else f"Flávio {_pct(100 - pl, d)}"


def _resumo(p: dict, escopo: str) -> str:
    lado = "Lula" if p["lula_pct"] >= 50 else "Flávio"
    fav, q = ("Lula", p["prob_lula"]) if p["prob_lula"] >= 50 else ("Flávio", 100 - p["prob_lula"])
    return (f"{escopo}: Lula {_pct(p['lula_pct'])} × Flávio {_pct(100 - p['lula_pct'])} "
            f"(faixa provável: {_lider(p['p10'])} a {_lider(p['p90'])}). Chance de vitória de {fav}: {_pct(q, 0)}. "
            f"{lado} à frente por {_votos(p['margem_votos'])} votos.")


def _chances(db: DB, p: dict, pref: str, escopo: str, silencioso: bool = False) -> None:
    q = p["prob_lula"]
    for lado, v in (("Lula", q), ("Flávio", 100 - q)):
        # só o limiar mais alto cruzado vira mensagem; os de baixo ficam marcados em silêncio
        cruzados = [t for t in LIMIARES_CHANCE if v >= t]
        if not cruzados:
            continue
        topo = cruzados[-1]
        if not silencioso:
            _avisar(db, f"{pref}_prob_{lado}_{topo}", f"{escopo}: chance de {lado} passou de {topo}%.\n{_resumo(p, escopo)}")
        for t in cruzados if silencioso else cruzados[:-1]:
            db.execute("INSERT OR IGNORE INTO alerta VALUES (?,?,?)", (f"{pref}_prob_{lado}_{t}", datetime.now().isoformat(timespec="seconds"), "(silencioso)"))
    lado = "Lula" if p["lula_pct"] >= 50 else "Flávio"
    antes = _estado(db, f"{pref}_lado")
    if antes and antes != lado:
        _avisar(db, f"{pref}_lado_{lado}_{datetime.now():%H%M}", f"{escopo}: a projeção virou para {lado}.\n{_resumo(p, escopo)}")
    _guardar(db, f"{pref}_lado", lado)


def verificar(db: DB, est: dict) -> None:
    _preparar(db)
    _avisar(db, "inicio", "Avisos da apuração ligados. Aviso aqui nos marcos: início da totalização, projeção, "
                          "viradas, chance passando de 90/95/99%, cada faixa de apurado, mercado andando forte e coleta com problema.")
    # exterior
    pe = (est.get("exterior") or {}).get("modelos", {}).get(MODELO) or {}
    if pe.get("disponivel") and pe.get("lula_pct") is not None:
        primeira = not _ja(db, "ext_disp")
        _avisar(db, "ext_disp", f"Primeira projeção do exterior.\n{_resumo(pe, 'Exterior')}")
        _chances(db, pe, "ext", "Exterior", silencioso=primeira)
    # Brasil
    n = est.get("nacional") or {}
    if est.get("fase") == "apurando":
        _avisar(db, "br_inicio", f"O TSE começou a totalizar: {_pct(n.get('apurado_pct'), 2)} apurado (TSE {str(n.get('hg', ''))[:5]}).")
        pb = (est.get("brasil") or {}).get("modelos", {}).get(MODELO) or {}
        if pb.get("disponivel") and pb.get("lula_pct") is not None:
            primeira = not _ja(db, "br_disp")
            _avisar(db, "br_disp", f"Primeira projeção do Brasil.\n{_resumo(pb, 'Brasil')}")
            _chances(db, pb, "br", "Brasil", silencioso=primeira)
            ap = n.get("apurado_pct") or 0
            cruzados = [m for m in MARCOS_APURADO if ap >= m]
            if cruzados and not primeira:
                m = cruzados[-1]
                cont = 100 * n["lula"] / n["validos"] if n.get("validos") else None
                _avisar(db, f"br_ap_{m}", f"{m}% apurado. Contado: {_lider(cont)}.\n{_resumo(pb, 'Projeção')}")
            for m in cruzados[:-1] if not primeira else cruzados:
                db.execute("INSERT OR IGNORE INTO alerta VALUES (?,?,?)", (f"br_ap_{m}", datetime.now().isoformat(timespec="seconds"), "(silencioso)"))
        if n.get("validos"):
            lado = "Lula" if n["lula"] * 2 >= n["validos"] else "Flávio"
            antes = _estado(db, "br_contado_lado")
            if antes and antes != lado:
                _avisar(db, f"br_contado_{lado}_{datetime.now():%H%M}",
                        f"Virada no contado: {lado} passou à frente com {_pct(n.get('apurado_pct'), 1)} apurado "
                        f"({_lider(100 * n['lula'] / n['validos'], 2)}).")
            _guardar(db, "br_contado_lado", lado)
    # mercados: chance média de Lula andando forte em 30 min
    s = ((est.get("movimentos") or {}).get("series") or {})
    pts = [x for x in (s.get("poly") or []) if x[1] is not None], [x for x in (s.get("kalshi") or []) if x[1] is not None]
    if all(pts):
        agora = min(pts[0][-1][0], pts[1][-1][0])

        def em(serie, t):
            v = None
            for m, x in serie:
                if m > t:
                    break
                v = x
            return v

        a = [em(sr, agora - 30) for sr in pts]
        b = [em(sr, agora) for sr in pts]
        if None not in a and None not in b:
            d = 100 * (sum(b) - sum(a)) / 2
            if abs(d) >= MOV_MERCADO_PP:
                lado = "Lula" if d > 0 else "Flávio"
                _avisar(db, f"mk_{int(agora // 30)}", f"Mercado andou {_pct(abs(d)).rstrip('%')} pp para {lado} em 30 min. "
                        f"Chance de vitória: {_lider(100 * sum(a) / 2)} → {_lider(100 * sum(b) / 2)} (média Polymarket e Kalshi).")
    # coleta
    try:
        vg = json.loads(((est.get("saude") or {}).get("vigia") or {}).get("valor") or "{}")
    except Exception:  # noqa: BLE001
        vg = {}
    if vg.get("status") == "alerta":
        _avisar(db, f"vigia_{datetime.now():%H}{datetime.now().minute // 30}",
                "Coleta com problema: " + "; ".join(vg.get("problemas") or ["sem detalhe"]))
