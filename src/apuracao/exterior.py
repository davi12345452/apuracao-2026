"""Exterior antes das 17h: varre as seções e decodifica cada BU assim que o TSE o publica."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from analise_urnas.httpclient import HttpClient, HttpError
from analise_urnas.parsers.bu import parse_bu

from . import tse
from .db import DB

DATA = Path(__file__).resolve().parents[2] / "data"


def agora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def cliente(min_interval: float = 0.2) -> HttpClient:
    return HttpClient(min_interval=min_interval, retries=2, backoff_factor=0.5, timeout=(5, 20),
                      user_agent="apuracao-2026/0.1 (painel local, uso pessoal)")


def preparar(db: DB, http: HttpClient) -> int:
    """Cadastra as seções do exterior (cs.json) e o país de cada cidade. Idempotente."""
    cs = http.get_json(tse.url_cs("zz"))
    rows = [(m, z, s, nome) for m, nome, z, s in tse.secoes_cs(cs)]
    db.executemany("INSERT OR IGNORE INTO secao_ext (mun, zona, secao, cidade) VALUES (?,?,?,?)", rows)
    paises = json.loads((DATA / "cidades_exterior.json").read_text(encoding="utf-8"))
    nomes = {m: nome for m, nome, _, _ in tse.secoes_cs(cs)}
    db.executemany(
        "INSERT OR REPLACE INTO municipio (uf, mun, nome, ibge, pais, iso3) VALUES ('zz',?,?,'',?,?)",
        [(m, nomes.get(m, p.get("cidade")), p["pais"], p["iso3"]) for m, p in paises.items()],
    )
    return len(rows)


def escolher_hash(aux: dict) -> dict | None:
    hashes = aux.get("hashes") or []
    if not hashes:
        return None
    return next((h for h in hashes if h.get("st") == "Totalizado"), hashes[-1])


def baixar_secao(http: HttpClient, mun: str, zona: str, secao: str) -> dict | None:
    """BU resumido da seção, ou None se o TSE ainda não publicou."""
    try:
        aux = http.get_json(tse.url_aux("zz", mun, zona, secao))
    except HttpError as e:
        if e.status in (403, 404):
            return None
        raise
    h = escolher_hash(aux)
    if not h:
        return None
    arq = next((a for a in h.get("arq") or [] if a.get("tp") == "bu"), None)
    if not arq:
        return None
    raw = http.get_bytes(f"{tse.secao_dir('zz', mun, zona, secao)}/{h['hash']}/{arq['nm']}")
    res = tse.resumo_bu(parse_bu(raw))
    res["recebido_tse"] = f"{h.get('dr', '')} {h.get('hr', '')}".strip()
    return res


def varrer(db: DB, http: HttpClient, workers: int = 4) -> dict:
    """Uma passada nas seções pendentes. Devolve contagem de novos BUs e erros."""
    pend = db.query("SELECT mun, zona, secao FROM secao_ext WHERE status != 'ok' ORDER BY tentativas, mun")
    novos = erros = 0

    def um(r):
        try:
            return r, baixar_secao(http, r["mun"], r["zona"], r["secao"]), None
        except Exception as e:  # noqa: BLE001 - uma seção ruim não derruba a varredura
            return r, None, e

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for r, res, err in ex.map(um, pend):
            chave = (r["mun"], r["zona"], r["secao"])
            if err is not None:
                erros += 1
                db.execute("UPDATE secao_ext SET status='erro', tentativas=tentativas+1, ultima_consulta=? "
                           "WHERE mun=? AND zona=? AND secao=?", (agora(), *chave))
                db.log("erro", f"BU {chave}: {err}")
            elif res is None:
                db.execute("UPDATE secao_ext SET tentativas=tentativas+1, ultima_consulta=? "
                           "WHERE mun=? AND zona=? AND secao=?", (agora(), *chave))
            else:
                novos += 1
                db.execute(
                    "INSERT OR REPLACE INTO bu VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (*chave, res["recebido_tse"], agora(), res["aptos"], res["comparecimento"],
                     res["lula"], res["flavio"], res["brancos"], res["nulos"],
                     res["encerramento"], res["emissao"]),
                )
                db.execute("UPDATE secao_ext SET status='ok', ultima_consulta=? WHERE mun=? AND zona=? AND secao=?",
                           (agora(), *chave))
    return {"pendentes": len(pend), "novos": novos, "erros": erros}
