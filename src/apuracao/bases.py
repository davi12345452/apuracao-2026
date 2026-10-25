"""Bases de comparação por município: 1º turno 2026 (portal) e 1º/2º turnos 2022 (dados abertos).

Uso: python -m apuracao.bases [2022] [2026_1t]
"""

from __future__ import annotations

import csv
import os
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from analise_urnas.remotezip import RemoteZip

from . import tse
from .db import DB
from .exterior import cliente
from .oficial import ler_u

CACHE = Path(os.environ.get("APURACAO_DATA", Path(__file__).resolve().parents[2] / "data")) / "cache"
ZIP_CAND = "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2022.zip"
ZIP_DET = "https://cdn.tse.jus.br/estatistica/sead/odsele/detalhe_votacao_munzona/detalhe_votacao_munzona_2022.zip"
CSV_CAND = "votacao_candidato_munzona_2022_BR.csv"
CSV_DET = "detalhe_votacao_munzona_2022_BR.csv"

INSERT_BASE = "INSERT OR REPLACE INTO base VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"


def _csv_2022(nome: str, url: str) -> Path:
    dest = CACHE / nome
    if not dest.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        z = RemoteZip(url, cliente(0.1), CACHE)
        for _, b in z.read_members([z.by_name[nome]]):
            dest.write_bytes(b)
    return dest


def _linhas(path: Path):
    with open(path, encoding="latin-1", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


def agregar_2022(path_det: Path, path_cand: Path) -> dict[tuple[str, str, str], dict]:
    """{(fonte, uf, mun): totais} para presidente, somando zonas e voto em trânsito."""
    tot: dict[tuple[str, str, str], dict] = defaultdict(lambda: defaultdict(int))
    for r in _linhas(path_det):
        if r["CD_CARGO"] != "1":
            continue
        k = (f"2022_{r['NR_TURNO']}t", r["SG_UF"].lower(), r["CD_MUNICIPIO"].zfill(5))
        t = tot[k]
        t["aptos"] += int(r["QT_APTOS"])
        t["comparecimento"] += int(r["QT_COMPARECIMENTO"])
        t["abstencao"] += int(r["QT_ABSTENCOES"])
        t["validos"] += int(r["QT_TOTAL_VOTOS_VALIDOS"])
        t["brancos"] += int(r["QT_VOTOS_BRANCOS"])
        t["nulos"] += int(r["QT_TOTAL_VOTOS_NULOS"])
    for r in _linhas(path_cand):
        if r["CD_CARGO"] != "1":
            continue
        k = (f"2022_{r['NR_TURNO']}t", r["SG_UF"].lower(), r["CD_MUNICIPIO"].zfill(5))
        v = int(r["QT_VOTOS_NOMINAIS_VALIDOS"] or 0)
        campo = {"13": "lula", "22": "direita"}.get(r["NR_CANDIDATO"], "outros")
        tot[k][campo] += v
    return tot


def carregar_2022(db: DB) -> int:
    tot = agregar_2022(_csv_2022(CSV_DET, ZIP_DET), _csv_2022(CSV_CAND, ZIP_CAND))
    rows = [
        (f, uf, mun, t["aptos"], t["comparecimento"], t["abstencao"], t["validos"], t["brancos"], t["nulos"],
         t["lula"], t["direita"], t["outros"])
        for (f, uf, mun), t in tot.items()
    ]
    db.executemany(INSERT_BASE, rows)
    return len(rows)


def carregar_2026_1t(db: DB, workers: int = 3) -> int:
    """Resultado final do 1º turno de 2026 por município, lido do portal (um -u por município)."""
    http = cliente(0.08)
    cm = http.get_json(tse.url_cm(tse.ELE_1T))
    db.executemany(
        "INSERT OR IGNORE INTO municipio (uf, mun, nome, ibge) VALUES (?,?,?,?)",
        [(a["cd"].lower(), m["cd"], m["nm"], m.get("cdi", "")) for a in cm["abr"] for m in a["mu"]],
    )
    feitos = {(r["uf"], r["mun"]) for r in db.query("SELECT uf, mun FROM base WHERE fonte='2026_1t'")}
    alvo = [(a["cd"].lower(), m["cd"]) for a in cm["abr"] for m in a["mu"] if (a["cd"].lower(), m["cd"]) not in feitos]

    def um(k):
        uf, mun = k
        try:
            d = http.get_json(tse.url_u(uf, tse.ELE_1T, mun))
        except Exception as e:  # noqa: BLE001
            return k, None, e
        return k, tse.parse_u(d), None

    n = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for (uf, mun), p, err in ex.map(um, alvo):
            if err or not p:
                db.log("erro", f"base 2026_1t {uf}{mun}: {err}")
                continue
            outros = p["vv"] - p["lula"] - p["flavio"]
            db.execute(INSERT_BASE, ("2026_1t", uf, mun, p["te"], p["c"], p["a"], p["vv"], p["vb"], p["vn"],
                                     p["lula"], p["flavio"], outros))
            n += 1
    return n


def main(argv: list[str] | None = None) -> None:
    alvo = set(argv if argv is not None else sys.argv[1:]) or {"2022", "2026_1t"}
    db = DB()
    if "2022" in alvo:
        print("2022:", carregar_2022(db))
    if "2026_1t" in alvo:
        print("2026_1t:", carregar_2026_1t(db))
    for r in db.query("SELECT fonte, count(*) n, sum(aptos) aptos, sum(comparecimento) comp, sum(validos) vv, "
                      "sum(lula) lula, sum(direita) direita, sum(outros) outros FROM base GROUP BY fonte"):
        print(r)


if __name__ == "__main__":
    main()

