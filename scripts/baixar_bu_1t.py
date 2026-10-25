"""Baixa uma vez os boletins de urna do 1º turno (pleito 3220) das seções do exterior para a tabela bu_1t.

Serve para comparar cada boletim do 2º turno com a MESMA seção no 1º turno. Retomável: pula as seções já
gravadas. Educado: 2 workers, intervalo mínimo entre requisições (rate limit global do cliente).

    nice .venv/bin/python scripts/baixar_bu_1t.py [--intervalo 0.25] [--limite N]
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from analise_urnas.httpclient import HttpError  # noqa: E402
from analise_urnas.parsers.bu import parse_bu  # noqa: E402

from apuracao import tse  # noqa: E402
from apuracao.db import DB  # noqa: E402
from apuracao.exterior import agora, cliente, escolher_hash  # noqa: E402

PLEITO_1T = 3220

SCHEMA = """
CREATE TABLE IF NOT EXISTS bu_1t (           -- BUs do 1º turno no exterior (mesmas colunas de bu)
    mun TEXT NOT NULL, zona TEXT NOT NULL, secao TEXT NOT NULL,
    recebido_tse TEXT, baixado_em TEXT,
    aptos INTEGER, comparecimento INTEGER,
    lula INTEGER, flavio INTEGER, brancos INTEGER, nulos INTEGER,
    encerramento TEXT, emissao TEXT,
    PRIMARY KEY (mun, zona, secao)
);
"""


def baixar(http, mun: str, zona: str, secao: str) -> dict | None:
    try:
        aux = http.get_json(tse.url_aux("zz", mun, zona, secao, PLEITO_1T))
    except HttpError as e:
        if e.status in (403, 404):
            return None
        raise
    h = escolher_hash(aux)
    arq = next((a for a in (h or {}).get("arq") or [] if a.get("tp") in ("bu", "busa")), None)  # busa: seção com cédula
    if not arq:
        return None
    raw = http.get_bytes(f"{tse.secao_dir('zz', mun, zona, secao, PLEITO_1T)}/{h['hash']}/{arq['nm']}")
    res = tse.resumo_bu(parse_bu(raw))
    res["recebido_tse"] = f"{h.get('dr', '')} {h.get('hr', '')}".strip()
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--intervalo", type=float, default=0.25)
    ap.add_argument("--limite", type=int, default=0)
    a = ap.parse_args()
    db = DB()
    db.conn.executescript(SCHEMA)
    pend = db.query("SELECT s.mun, s.zona, s.secao FROM secao_ext s LEFT JOIN bu_1t b "
                    "USING (mun, zona, secao) WHERE b.mun IS NULL ORDER BY s.mun, s.zona, s.secao")
    if a.limite:
        pend = pend[: a.limite]
    http = cliente(a.intervalo)
    ok = vazio = erro = 0
    t0 = time.monotonic()

    def um(r):
        try:
            return r, baixar(http, r["mun"], r["zona"], r["secao"]), None
        except Exception as e:  # noqa: BLE001
            return r, None, e

    with ThreadPoolExecutor(max_workers=2) as ex:
        for i, (r, res, err) in enumerate(ex.map(um, pend), 1):
            if err is not None:
                erro += 1
                print(f"erro {r['mun']}/{r['zona']}/{r['secao']}: {err}", file=sys.stderr)
            elif res is None:
                vazio += 1
            else:
                ok += 1
                db.execute("INSERT OR REPLACE INTO bu_1t VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           (r["mun"], r["zona"], r["secao"], res["recebido_tse"], agora(), res["aptos"],
                            res["comparecimento"], res["lula"], res["flavio"], res["brancos"], res["nulos"],
                            res["encerramento"], res["emissao"]))
            if i % 100 == 0:
                print(f"{i}/{len(pend)} · ok {ok} · sem BU {vazio} · erros {erro} · {time.monotonic() - t0:.0f} s", flush=True)
    print(f"fim: {len(pend)} seções · ok {ok} · sem BU {vazio} · erros {erro} · {time.monotonic() - t0:.0f} s")


if __name__ == "__main__":
    main()
