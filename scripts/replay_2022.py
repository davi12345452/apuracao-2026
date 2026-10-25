"""Ensaio ponta a ponta: um TSE falso serve o 2º turno de 2022 em passos, no formato dos arquivos de 2026.

O coletor oficial (oficial.ciclo_topo / ciclo_ufs) lê do servidor falso por HTTP, grava num SQLite
temporário e o painel (painel.estado) calcula tudo como faria hoje à noite. No banco temporário, a
base "2026_1t" recebe o 1º turno de 2022, para que a projeção por transferência seja testada no
papel que terá hoje.

Uso: python scripts/replay_2022.py [--servir PORTA]
Critérios: no fim os totais do painel batem exatamente com 2022; erro da projeção ≤ 1,5 pp com 30%
e ≤ 0,7 pp com 60%; nenhum erro registrado pelo coletor.
"""

from __future__ import annotations

import csv
import json
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from collections import defaultdict
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

from apuracao import oficial, tse  # noqa: E402
from apuracao.db import DB, DB_PATH  # noqa: E402
from apuracao.exterior import cliente  # noqa: E402
from apuracao.painel import estado  # noqa: E402

CACHE = RAIZ / "data" / "cache"
PASSOS = [0.0, 0.01, 0.03, 0.06, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.97, 1.0]


def ler_2t():
    z = defaultdict(lambda: defaultdict(int))
    with open(CACHE / "detalhe_votacao_munzona_2022_BR.csv", encoding="latin-1", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            if r["CD_CARGO"] != "1" or r["NR_TURNO"] != "2":
                continue
            k = (r["SG_UF"].lower(), r["CD_MUNICIPIO"].zfill(5), r["NR_ZONA"])
            for campo, col in (("aptos", "QT_APTOS"), ("c", "QT_COMPARECIMENTO"), ("vv", "QT_TOTAL_VOTOS_VALIDOS"),
                               ("vb", "QT_VOTOS_BRANCOS"), ("vn", "QT_TOTAL_VOTOS_NULOS"), ("secoes", "QT_TOTAL_SECOES")):
                z[k][campo] += int(r[col])
    with open(CACHE / "votacao_candidato_munzona_2022_BR.csv", encoding="latin-1", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            if r["CD_CARGO"] != "1" or r["NR_TURNO"] != "2":
                continue
            k = (r["SG_UF"].lower(), r["CD_MUNICIPIO"].zfill(5), r["NR_ZONA"])
            z[k]["lula" if r["NR_CANDIDATO"] == "13" else "flavio"] += int(r["QT_VOTOS_NOMINAIS_VALIDOS"] or 0)
    return z


def doc_u(abr, tpabr, t, dg, hg):
    s = lambda x: str(int(x))  # noqa: E731
    return {
        "ele": "6258", "t": "2", "f": "o", "tpabr": tpabr, "cdabr": abr, "dg": dg, "hg": hg, "and": "p",
        "carg": [{"cd": "1", "agr": [
            {"par": [{"cand": [{"n": "22", "nmu": "FLAVIO BOLSONARO", "vap": s(t["flavio"])}]}]},
            {"par": [{"cand": [{"n": "13", "nmu": "LULA", "vap": s(t["lula"])}]}]},
        ]}],
        "s": {"ts": s(t["secoes_tot"]), "st": s(t["secoes"])},
        "e": {"te": s(t["te"]), "est": s(t["aptos"]), "c": s(t["c"]), "a": s(t["aptos"] - t["c"])},
        "v": {"tv": s(t["c"]), "vv": s(t["vv"]), "vb": s(t["vb"]), "tvn": s(t["vn"])},
    }


def escrever(raiz: Path, uf: str, nome: str, doc: dict) -> None:
    p = raiz / "oficial" / "ele2026" / "6258" / "dados" / uf / nome
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    tmp.replace(p)


def main():
    servir = int(sys.argv[sys.argv.index("--servir") + 1]) if "--servir" in sys.argv else None
    zonas = ler_2t()
    chaves = sorted(zonas)
    tot_mun = defaultdict(lambda: defaultdict(int))
    for (uf, mun, z), v in zonas.items():
        tot_mun[(uf, mun)]["te"] += v["aptos"]
        tot_mun[(uf, mun)]["secoes_tot"] += v["secoes"]
    verdade = {k: sum(v[k] for v in zonas.values()) for k in ("lula", "flavio", "vv", "c", "aptos")}
    real = 100 * verdade["lula"] / verdade["vv"]

    # ordem realista: interior pequeno primeiro, capitais e exterior por último
    rng = np.random.default_rng(42)
    ruido = rng.random(len(chaves))
    ordem = sorted(range(len(chaves)), key=lambda i: (chaves[i][0] == "zz",
                                                      np.log(tot_mun[chaves[i][:2]]["te"]) + 2.5 * ruido[i]))

    tmpdir = Path(tempfile.mkdtemp(prefix="replay2022-"))
    raiz_http = tmpdir / "www"
    dbp = tmpdir / "replay.db"
    db = DB(dbp)
    db.conn.execute("ATTACH DATABASE ? AS real", (str(DB_PATH),))
    db.conn.execute("INSERT INTO municipio SELECT * FROM real.municipio")
    db.conn.execute("INSERT INTO base SELECT * FROM real.base WHERE fonte IN ('2022_1t','2022_2t')")
    db.conn.execute("INSERT INTO base SELECT '2026_1t', uf, mun, aptos, comparecimento, abstencao, validos, brancos, "
                    "nulos, lula, direita, outros FROM real.base WHERE fonte='2022_1t'")
    db.conn.commit()
    db.conn.execute("DETACH DATABASE real")

    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quieto, directory=str(raiz_http)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tse.BASE = f"http://127.0.0.1:{srv.server_address[1]}/oficial"
    http = cliente(0.0)

    revelado = np.zeros(len(chaves), dtype=bool)
    tot_el = sum(v["aptos"] for v in zonas.values())
    hist = []
    t0 = time.monotonic()
    for i, frac in enumerate(PASSOS):
        acum = 0
        for j in ordem:
            if acum >= frac * tot_el and frac < 1:
                break
            revelado[j] = True
            acum += zonas[chaves[j]]["aptos"]
        hg = f"17:{i * 3:02d}:00" if i * 3 < 60 else f"18:{i * 3 - 60:02d}:00"
        agg = defaultdict(lambda: defaultdict(int))
        for j, k in enumerate(chaves):
            uf, mun, _ = k
            alvos = [("br", None), (uf, None), (uf, mun)]
            for a in alvos:
                t = agg[a]
                t["te"] += zonas[k]["aptos"]
                t["secoes_tot"] += zonas[k]["secoes"]
                if revelado[j]:
                    for c in ("aptos", "c", "vv", "vb", "vn", "lula", "flavio", "secoes"):
                        t[c] += zonas[k][c]
        for (abr, mun), t in agg.items():
            if abr == "br":
                escrever(raiz_http, "br", "br-c0001-e006258-u.json", doc_u("br", "br", t, "30/10/2022", hg))
            elif mun is None:
                escrever(raiz_http, abr, f"{abr}-c0001-e006258-u.json", doc_u(abr, "uf", t, "30/10/2022", hg))
            else:
                escrever(raiz_http, abr, f"{abr}{mun}-c0001-e006258-u.json", doc_u(mun, "mu", t, "30/10/2022", hg))
        for uf in tse.UFS + ["zz"]:
            ab = {"abr": [{"cdabr": mun, "tpabr": "mun", "and": "p",
                           "s": {"ts": str(t["secoes_tot"]), "st": str(t["secoes"])},
                           "e": {"te": str(t["te"]), "est": str(t["aptos"]), "c": str(t["c"]), "a": str(t["aptos"] - t["c"])}}
                          for (a, mun), t in agg.items() if a == uf and mun]}
            escrever(raiz_http, uf, f"{uf}-e006258-ab.json", ab)

        oficial.ciclo_topo(db, http)
        r = oficial.ciclo_ufs(db, http, max_mun=20000)
        e = estado(db)
        P = e.get("projecoes", {})
        linha = {"frac": frac, "hg": hg, "apurado_pct": (e["nacional"] or {}).get("apurado_pct"),
                 "lula_pct_parcial": (e["nacional"] or {}).get("lula_pct"), **r}
        for nome, p in P.items():
            if "lula_pct" in p:
                linha[nome] = round(p["lula_pct"], 3)
                linha[nome + "_erro"] = round(p["lula_pct"] - real, 3)
                linha[nome + "_faixa"] = (round(p["p10"], 2), round(p["p90"], 2))
                linha[nome + "_disp"] = p["disponivel"]
        hist.append(linha)
        print(json.dumps(linha, ensure_ascii=False))

    fim = estado(db)
    n = fim["nacional"]
    erros = db.query("SELECT * FROM evento WHERE nivel='erro'")
    soma_mun = db.one("SELECT sum(lula) l, sum(flavio) f, sum(validos) v FROM mun")
    checks = {
        "br_lula_exato": n["lula"] == verdade["lula"],
        "br_flavio_exato": n["flavio"] == verdade["flavio"],
        "br_validos_exato": n["validos"] == verdade["vv"],
        "mun_soma_exata": (soma_mun["l"], soma_mun["f"], soma_mun["v"]) == (verdade["lula"], verdade["flavio"], verdade["vv"]),
        "proj_final_exata": all(abs(p["lula_pct"] - real) < 1e-6 for p in fim["projecoes"].values()),
        "sem_erros_coletor": not erros,
    }
    for nome in ("vs_2026_1t", "vs_2022_2t"):
        e30 = next(h for h in hist if h["frac"] == 0.3).get(nome + "_erro")
        e60 = next(h for h in hist if h["frac"] == 0.6).get(nome + "_erro")
        checks[f"{nome}_30pct_≤1,5pp"] = e30 is not None and abs(e30) <= 1.5
        checks[f"{nome}_60pct_≤0,7pp"] = e60 is not None and abs(e60) <= 0.7
    print(f"\nreal 2022: Lula {real:.3f}%   tempo {time.monotonic() - t0:.0f}s   banco {dbp}")
    for k, v in checks.items():
        print(f"  {'OK ' if v else 'FALHOU'} {k}")
    (tmpdir / "estado_final.json").write_text(json.dumps(fim, ensure_ascii=False, default=str))
    ok = all(checks.values())
    if servir:
        from apuracao.server import Estado, handler

        print(f"painel do ensaio em http://127.0.0.1:{servir}")
        ThreadingHTTPServer(("127.0.0.1", servir), handler(Estado(db))).serve_forever()
    srv.shutdown()
    shutil.rmtree(raiz_http, ignore_errors=True)
    sys.exit(0 if ok else 1)


class _Quieto(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


if __name__ == "__main__":
    main()
