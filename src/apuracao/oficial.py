"""Totalização oficial (a partir das 17h): br, zz, UFs, avanço por município e votos por município."""

from __future__ import annotations

from analise_urnas.httpclient import HttpClient, HttpError

from . import tse
from .db import DB
from .exterior import agora

CAMPOS = ("secoes_tot", "secoes_apur", "eleitorado", "eleitorado_apur", "comparecimento", "abstencao",
          "validos", "brancos", "nulos", "lula", "flavio")


def _valores(p: dict) -> tuple:
    return (p["ts"], p["st"], p["te"], p["est"], p["c"], p["a"], p["vv"], p["vb"], p["vn"], p["lula"], p["flavio"])


def gravar_snap(db: DB, abr: str, p: dict) -> bool:
    """Grava um ponto da série se (dg, hg) for novo. True se gravou."""
    cur = db.execute(
        f"INSERT OR IGNORE INTO snap (ts_coleta, abr, dg, hg, {', '.join(CAMPOS)}) VALUES (?,?,?,?,{','.join('?' * 11)})",
        (agora(), abr, p["dg"], p["hg"], *_valores(p)),
    )
    return cur.rowcount > 0


def ler_u(http: HttpClient, uf: str, mun: str | None = None) -> dict | None:
    try:
        return tse.parse_u(http.get_json(tse.url_u(uf, mun=mun)))
    except HttpError as e:
        if e.status in (403, 404):
            return None
        raise


def ciclo_topo(db: DB, http: HttpClient) -> dict:
    """br e zz. Devolve o parse do br (para decidir se vale ler as UFs)."""
    out = {}
    for abr in ("br", "zz"):
        p = ler_u(http, abr)
        if p:
            gravar_snap(db, abr, p)
            out[abr] = p
    return out


def ciclo_ufs(db: DB, http: HttpClient, ler_municipios: bool = True, max_mun: int = 400) -> dict:
    """UFs: snapshot, avanço por município (-ab) e votos dos municípios que avançaram."""
    mudaram: list[tuple[str, str]] = []
    for uf in tse.UFS + ["zz"]:
        if uf != "zz":
            p = ler_u(http, uf)
            if p:
                gravar_snap(db, uf, p)
        try:
            ab = tse.parse_ab(http.get_json(tse.url_ab(uf)))
        except HttpError as e:
            db.log("aviso", f"ab {uf}: {e}")
            continue
        antes = {r["mun"]: r["secoes_apur"] for r in db.query("SELECT mun, secoes_apur FROM mun WHERE uf=?", (uf,))}
        db.executemany(
            "INSERT OR REPLACE INTO mun_ab VALUES (?,?,?,?,?,?,?,?)",
            [(uf, a["mun"], a["ts"], a["st"], a["te"], a["est"], a["c"], a["a"]) for a in ab],
        )
        for a in ab:
            if a["st"] > 0 and a["st"] != antes.get(a["mun"], -1):
                # nunca lido vem primeiro; depois quem mais avançou desde a última leitura
                mudaram.append((a["mun"] in antes, -(a["st"] - antes.get(a["mun"], 0)), uf, a["mun"]))
    lidos = 0
    if ler_municipios:
        mudaram.sort()
        for _, _, uf, mun in mudaram[:max_mun]:
            p = ler_u(http, uf, mun)
            if not p:
                continue
            db.execute(
                f"INSERT OR REPLACE INTO mun (uf, mun, dg, hg, {', '.join(CAMPOS)}) VALUES (?,?,?,?,{','.join('?' * 11)})",
                (uf, mun, p["dg"], p["hg"], *_valores(p)),
            )
            lidos += 1
    return {"municipios_avancaram": len(mudaram), "municipios_lidos": lidos}
