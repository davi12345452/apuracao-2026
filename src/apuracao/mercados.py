"""Cotações de Polymarket e Kalshi para o 2º turno (só leitura de APIs públicas).

O DNS da rede local não resolve esses domínios (bloqueio de sites de aposta no Brasil); as
requisições resolvem o nome por DNS-over-HTTPS (Cloudflare) via curl --doh-url.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import time
from datetime import datetime

DOH = "https://cloudflare-dns.com/dns-query"
POLY = "https://gamma-api.polymarket.com/events?slug="
KALSHI = "https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=100&series_ticker="
KALSHI_VELAS = "https://api.elections.kalshi.com/trade-api/v2/series/{serie}/markets/{ticker}/candlesticks?start_ts={de}&end_ts={ate}&period_interval=1"
POLY_HIST = "https://clob.polymarket.com/prices-history?market={token}&startTs={de}&fidelity=5"
JANELA_HIST = 30 * 3600  # histórico: últimas 30 h (cobre o dia da eleição desde a madrugada)

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
    # --max-filesize: resposta gigante de uma API com problema não estoura a memória do container
    out = subprocess.run(["curl", "-s", "--globoff", "--proto", "=https", "--max-filesize", "20000000", "-m", str(timeout), "--doh-url", DOH,
                          "-H", "Accept: application/json", url],
                         capture_output=True, timeout=timeout + 5, check=True)
    return json.loads(out.stdout)


def _p(x) -> float | None:
    """Preço/probabilidade: só número finito entre 0 e 1 (valor absurdo de uma API não chega ao painel)."""
    v = _f(x)
    return v if v is not None and math.isfinite(v) and 0 <= v <= 1 else None


def _f(x) -> float | None:
    try:
        v = float(x)
        return v if math.isfinite(v) else None  # "NaN"/"Infinity" de uma API viraria JSON inválido no navegador
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
        sim = _p(precos[0]) if precos else None
        bid, ask = _p(m.get("bestBid")), _p(m.get("bestAsk"))
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
        bid, ask = _p(m.get("yes_bid_dollars")), _p(m.get("yes_ask_dollars"))
        last = _p(m.get("last_price_dollars"))
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


# ---------- histórico (APIs de séries; preenche o dia inteiro, inclusive antes do coletor subir) ----------

def _poly_token_lula(slug: str) -> str | None:
    ev = _get(POLY + slug)
    ev = ev[0] if isinstance(ev, list) and ev else ev
    for m in (ev or {}).get("markets") or []:
        if not m.get("closed") and _lado(m.get("question", "")) == "lula":
            return json.loads(m.get("clobTokenIds") or "[]")[0]
    return None


def _poly_hist(slug: str, de: int) -> list[tuple[int, float]]:
    tok = _poly_token_lula(slug)
    if not tok:
        return []
    if not re.fullmatch(r"\d{1,100}", str(tok)):  # id vindo da API vai para a URL: só dígitos
        return []
    h = _get(POLY_HIST.format(token=tok, de=de)).get("history") or []
    return [(int(p["t"]), _p(p["p"])) for p in h if _p(p.get("p")) is not None]


def _kalshi_velas(serie: str, ticker: str, de: int, ate: int) -> list[tuple[int, float]]:
    """Velas de 1 min → ponto médio entre compra e venda no fechamento de cada minuto."""
    if not re.fullmatch(r"[A-Z0-9._-]{1,80}", ticker or ""):  # ticker vindo da API vai para a URL
        return []
    d = _get(KALSHI_VELAS.format(serie=serie, ticker=ticker, de=de, ate=ate), timeout=30)
    out = []
    for c in d.get("candlesticks") or []:
        bid = _p((c.get("yes_bid") or {}).get("close_dollars"))
        ask = _p((c.get("yes_ask") or {}).get("close_dollars"))
        if bid is not None and ask is not None and 0 <= ask - bid <= 0.1:
            out.append((int(c["end_period_ts"]), (bid + ask) / 2))
        elif _p((c.get("price") or {}).get("close_dollars")) is not None:
            out.append((int(c["end_period_ts"]), _p(c["price"]["close_dollars"])))
    return out


def _kalshi_ticker_lula(serie: str) -> str | None:
    for m in _kalshi(serie):
        if _lado(m["rotulo"]) == "lula":
            return m["ticker"]
    return None


def historico(db) -> dict:
    """Atualiza mercado_serie com as últimas JANELA_HIST horas. Séries (todas sobre Lula):
    vencedor, exterior (prob. de vencer) e, na Kalshi, fatia_mediana (fatia de Lula nos válidos
    implícita na escada KXVOTEBR2, minuto a minuto)."""
    ate = int(time.time())
    de = ate - JANELA_HIST
    linhas: list[tuple] = []
    res = {}
    try:
        linhas += [("polymarket", "vencedor", t, v) for t, v in _poly_hist(POLY_EVENTOS["vencedor"], de)]
        linhas += [("polymarket", "exterior", t, v) for t, v in _poly_hist(POLY_EVENTOS["exterior"], de)]
        res["polymarket"] = "ok"
    except Exception as e:  # noqa: BLE001
        res["polymarket"] = f"erro {e!r}"[:120]
    try:
        for nome, serie in (("vencedor", KALSHI_SERIES["vencedor"]), ("exterior", KALSHI_SERIES["exterior"])):
            tk = _kalshi_ticker_lula(serie)
            if tk:
                linhas += [("kalshi", nome, t, v) for t, v in _kalshi_velas(serie, tk, de, ate)]
        # escada da fatia: um mercado por limiar; a mediana sai minuto a minuto
        por_min: dict[int, list[tuple[float, float]]] = {}
        for m in _kalshi(KALSHI_SERIES["fatia"]):
            t = m["ticker"] or ""
            try:
                limiar = float(t.rsplit("-", 1)[-1])
            except ValueError:
                continue
            lula = "LULA" in t
            if not lula and "FBOL" not in t:
                continue
            for ts, p in _kalshi_velas(KALSHI_SERIES["fatia"], t, de, ate):
                por_min.setdefault(ts, []).append((limiar, p) if lula else (100 - limiar, 1 - p))
        for ts, degraus in por_min.items():
            med = mediana_escada(degraus)
            if med is not None:
                linhas.append(("kalshi", "fatia_mediana", ts, med))
        res["kalshi"] = "ok"
    except Exception as e:  # noqa: BLE001
        res["kalshi"] = f"erro {e!r}"[:120]
    if linhas:
        db.executemany("INSERT OR REPLACE INTO mercado_serie VALUES (?,?,?,?)", linhas)
    res["pontos"] = len(linhas)
    db.batida("mercados_hist", json.dumps(res))
    return res
