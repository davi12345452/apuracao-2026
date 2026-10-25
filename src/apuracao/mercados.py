"""Cotações de Polymarket e Kalshi para o 2º turno (só leitura de APIs públicas).

O DNS da rede local não resolve esses domínios (bloqueio de sites de aposta no Brasil); as
requisições resolvem o nome por DNS-over-HTTPS (Cloudflare) via curl --doh-url.
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime

DOH = "https://cloudflare-dns.com/dns-query"
POLY = "https://gamma-api.polymarket.com/events?slug="
KALSHI = "https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=100&series_ticker="

POLY_EVENTOS = {
    "vencedor": "brazil-presidential-election",
    "margem": "brazil-presidential-election-second-round-specific-margin-of-victory",
    "comparecimento": "brazil-presidential-election-second-round-turnout",
    "exterior": "brazil-presidential-election-second-round-1st-place-abroad",
}
KALSHI_SERIES = {
    "vencedor": "KXBRPRES",
    "fatia": "KXVOTEBR2",
    "margem": "KXBRPRES2MOV",
    "comparecimento": "KXBRAZILTURNOUT",
    "exterior": "KXBRRUNOFFABROAD",
}


def _get(url: str, timeout: int = 20):
    out = subprocess.run(["curl", "-s", "-m", str(timeout), "--doh-url", DOH, "-H", "Accept: application/json", url],
                         capture_output=True, timeout=timeout + 5, check=True)
    return json.loads(out.stdout)


def _f(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _lado(texto: str) -> str | None:
    t = texto.lower()
    if "lula" in t or "silva" in t:
        return "lula"
    if "fl" in t and "bolsonaro" in t:
        return "flavio"
    return None


# ---------- Polymarket ----------

def _poly_mercados(slug: str) -> list[dict]:
    ev = _get(POLY + slug)
    ev = ev[0] if isinstance(ev, list) and ev else ev
    out = []
    for m in (ev or {}).get("markets") or []:
        if m.get("closed"):
            continue
        precos = json.loads(m.get("outcomePrices") or "[]")
        sim = _f(precos[0]) if precos else None
        bid, ask = _f(m.get("bestBid")), _f(m.get("bestAsk"))
        meio = (bid + ask) / 2 if bid is not None and ask is not None and ask - bid < 0.1 else sim
        out.append({"pergunta": m.get("question", ""), "rotulo": m.get("groupItemTitle") or "", "prob": meio,
                    "volume": _f(m.get("volume"))})
    return out


def polymarket() -> dict:
    r: dict = {"fonte": "polymarket"}
    venc = _poly_mercados(POLY_EVENTOS["vencedor"])
    for m in venc:
        lado = _lado(m["pergunta"])
        if lado:
            r[f"p_{lado}"] = m["prob"]
    r["margem"] = [{"rotulo": _rotulo_margem_poly(m["pergunta"]), "prob": m["prob"]}
                   for m in _poly_mercados(POLY_EVENTOS["margem"]) if _lado(m["pergunta"])]
    r["comparecimento"] = [{"rotulo": _rotulo_comp_poly(m["pergunta"]), "prob": m["prob"]}
                           for m in _poly_mercados(POLY_EVENTOS["comparecimento"])]
    for m in _poly_mercados(POLY_EVENTOS["exterior"]):
        lado = _lado(m["pergunta"])
        if lado:
            r[f"exterior_{lado}"] = m["prob"]
    return r


def _rotulo_margem_poly(q: str) -> str:
    lado = "Lula" if _lado(q) == "lula" else "Flávio"
    trecho = q.split(" by ")[-1].rstrip("?").replace("at least", "≥").replace("less than", "<")
    return f"{lado} {trecho}"


def _rotulo_comp_poly(q: str) -> str:
    return q.split(" be ")[-1].rstrip("?").replace("less than", "<").replace("or more", "ou mais")


# ---------- Kalshi ----------

def _kalshi(serie: str) -> list[dict]:
    d = _get(KALSHI + serie)
    out = []
    for m in d.get("markets") or []:
        bid, ask = _f(m.get("yes_bid_dollars")), _f(m.get("yes_ask_dollars"))
        last = _f(m.get("last_price_dollars"))
        meio = (bid + ask) / 2 if bid is not None and ask is not None and 0 <= ask - bid <= 0.1 else last
        out.append({"ticker": m.get("ticker"), "rotulo": m.get("yes_sub_title") or m.get("subtitle") or "",
                    "prob": meio, "volume": _f(m.get("volume_fp"))})
    return out


def mediana_escada(degraus: list[tuple[float, float]]) -> float | None:
    """Degraus (limiar, P(fatia ≥ limiar)) → limiar onde P cruza 50%, por interpolação linear."""
    agrup: dict[float, list[float]] = {}
    for x, p in degraus:
        if p is not None:
            agrup.setdefault(x, []).append(p)
    pts = sorted((x, sum(ps) / len(ps)) for x, ps in agrup.items())
    for (x0, p0), (x1, p1) in zip(pts, pts[1:]):
        if p0 >= 0.5 >= p1 and p0 != p1:
            return x0 + (p0 - 0.5) * (x1 - x0) / (p0 - p1)
    return None


def kalshi() -> dict:
    r: dict = {"fonte": "kalshi"}
    for m in _kalshi(KALSHI_SERIES["vencedor"]):
        lado = _lado(m["rotulo"])
        if lado:
            r[f"p_{lado}"] = m["prob"]
    escada = []
    for m in _kalshi(KALSHI_SERIES["fatia"]):
        t = m["ticker"] or ""
        try:
            limiar = float(t.rsplit("-", 1)[-1])
        except ValueError:
            continue
        if "LULA" in t:
            escada.append((limiar, m["prob"]))
        elif "FBOL" in t and m["prob"] is not None:
            escada.append((100 - limiar, 1 - m["prob"]))  # Flávio ≥ x  ⇔  Lula ≤ 100 − x
    agrup: dict[float, list[float]] = {}
    for x, p in escada:
        if p is not None:
            agrup.setdefault(x, []).append(p)
    r["escada_lula"] = [{"limiar": x, "prob": sum(ps) / len(ps)} for x, ps in sorted(agrup.items())]
    r["fatia_lula_mediana"] = mediana_escada(escada)
    r["margem"] = [{"rotulo": m["rotulo"].replace("Lula da Silva", "Lula").replace("Flávio Bolsonaro", "Flávio"),
                    "prob": m["prob"]} for m in _kalshi(KALSHI_SERIES["margem"])]
    comp = []
    for m in _kalshi(KALSHI_SERIES["comparecimento"]):
        try:
            comp.append({"limiar": int(m["ticker"].rsplit("-", 1)[-1]), "prob": m["prob"]})
        except ValueError:
            pass
    r["comparecimento_escada"] = sorted(comp, key=lambda x: x["limiar"])
    r["comparecimento_mediana"] = mediana_escada([(c["limiar"], c["prob"]) for c in comp])
    for m in _kalshi(KALSHI_SERIES["exterior"]):
        lado = _lado(m["rotulo"])
        if lado:
            r[f"exterior_{lado}"] = m["prob"]
    return r


def coletar(db) -> dict:
    agora = datetime.now().isoformat(timespec="seconds")
    res = {}
    for nome, fn in (("polymarket", polymarket), ("kalshi", kalshi)):
        try:
            d = fn()
            db.execute("INSERT INTO mercado VALUES (?,?,?)", (agora, nome, json.dumps(d, ensure_ascii=False)))
            res[nome] = "ok"
        except Exception as e:  # noqa: BLE001
            db.log("aviso", f"mercado {nome}: {e!r}")
            res[nome] = "erro"
    db.batida("mercados", json.dumps(res))
    return res
