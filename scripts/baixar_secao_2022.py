"""Grava uma vez o 2º turno de 2022 por SEÇÃO do exterior (Lula × Bolsonaro, aptos, comparecimento) na tabela secao_2022.

Fonte: boletim de urna na web (dados abertos do TSE), arquivo só do exterior (~430 KB):
https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/buweb/bweb_2t_ZZ_311020221535.zip
(o votacao_secao_2022_BR.zip tem 271 MB e o detalhe_votacao_secao não traz o exterior em arquivo próprio).

    nice .venv/bin/python scripts/baixar_secao_2022.py
"""

from __future__ import annotations

import csv
import io
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from apuracao.db import DB  # noqa: E402
from apuracao.exterior import cliente  # noqa: E402

URL = "https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/buweb/bweb_2t_ZZ_311020221535.zip"
CACHE = Path(__file__).resolve().parents[1] / "data" / "cache" / "bweb_2t_ZZ_2022.zip"

SCHEMA = """
CREATE TABLE IF NOT EXISTS secao_2022 (      -- 2º turno 2022 por seção do exterior (BU na web)
    mun TEXT NOT NULL, zona TEXT NOT NULL, secao TEXT NOT NULL,
    aptos INTEGER, comparecimento INTEGER,
    lula INTEGER, bolsonaro INTEGER, brancos INTEGER, nulos INTEGER,
    agregadas TEXT,                          -- seções agregadas a esta (votos somados aqui)
    PRIMARY KEY (mun, zona, secao)
);
"""


def main() -> None:
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(cliente(0.2).get_bytes(URL))
    z = zipfile.ZipFile(CACHE)
    nome = next(n for n in z.namelist() if n.endswith(".csv"))
    sec: dict[tuple, dict] = defaultdict(lambda: defaultdict(int))
    with z.open(nome) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";"):
            if r["CD_CARGO_PERGUNTA"] != "1" or r["NR_TURNO"] != "2":
                continue
            k = (r["CD_MUNICIPIO"].zfill(5), r["NR_ZONA"].zfill(4), r["NR_SECAO"].zfill(4))
            s = sec[k]
            s["aptos"], s["comparecimento"] = int(r["QT_APTOS"]), int(r["QT_COMPARECIMENTO"])
            s["agregadas"] = r["DS_AGREGADAS"] if r["DS_AGREGADAS"] not in ("#NULO#", "") else ""
            v, n, tipo = int(r["QT_VOTOS"]), r["NR_VOTAVEL"], r["DS_TIPO_VOTAVEL"]
            if n == "13":
                s["lula"] += v
            elif n == "22":
                s["bolsonaro"] += v
            elif tipo == "Branco":
                s["brancos"] += v
            elif tipo == "Nulo":
                s["nulos"] += v
    db = DB()
    db.conn.executescript(SCHEMA)
    db.executemany("INSERT OR REPLACE INTO secao_2022 VALUES (?,?,?,?,?,?,?,?,?,?)",
                   [(*k, s["aptos"], s["comparecimento"], s["lula"], s["bolsonaro"], s["brancos"], s["nulos"],
                     s["agregadas"] or "") for k, s in sec.items()])
    casam = db.one("SELECT count(*) n FROM secao_ext e JOIN secao_2022 s USING (mun, zona, secao)")["n"]
    tot = db.one("SELECT count(*) n FROM secao_ext")["n"]
    print(f"{len(sec)} seções de 2022 gravadas · {casam} de {tot} seções de 2026 casam por (município, zona, seção)")


if __name__ == "__main__":
    main()
