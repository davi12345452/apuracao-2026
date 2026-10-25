"""Backtest da projeção: simula a apuração do 2º turno de 2022 zona a zona e mede o erro.

A base é o 1º turno de 2022 (o mesmo papel que o 1º turno de 2026 tem hoje). Duas variantes:

- "transferencia": base_l + α·base_o (igual à projeção "2026_1t");
- "swing": só a fatia Lula/(Lula+Bolsonaro) do 1º turno (mesma mecânica da projeção "2022").

Uso: python scripts/backtest_2022.py [--rapido]
Critério do plano: com 30% apurado, erro ≤ 1,5 pp em ≥ 80% das ordens; com 60%, erro ≤ 0,7 pp.
"""

from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from apuracao import projecao  # noqa: E402
from apuracao.projecao import Unidades, projetar  # noqa: E402
from apuracao.tse import REGIAO  # noqa: E402

CACHE = Path(__file__).resolve().parents[1] / "data" / "cache"
FRACOES = [0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9]


def ler_zonas():
    det = defaultdict(lambda: defaultdict(int))
    with open(CACHE / "detalhe_votacao_munzona_2022_BR.csv", encoding="latin-1", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            if r["CD_CARGO"] != "1":
                continue
            k = (r["NR_TURNO"], r["SG_UF"].lower(), r["CD_MUNICIPIO"].zfill(5), r["NR_ZONA"])
            det[k]["aptos"] += int(r["QT_APTOS"])
            det[k]["comp"] += int(r["QT_COMPARECIMENTO"])
            det[k]["vv"] += int(r["QT_TOTAL_VOTOS_VALIDOS"])
    with open(CACHE / "votacao_candidato_munzona_2022_BR.csv", encoding="latin-1", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            if r["CD_CARGO"] != "1":
                continue
            k = (r["NR_TURNO"], r["SG_UF"].lower(), r["CD_MUNICIPIO"].zfill(5), r["NR_ZONA"])
            campo = {"13": "lula", "22": "bolso"}.get(r["NR_CANDIDATO"], "outros")
            det[k][campo] += int(r["QT_VOTOS_NOMINAIS_VALIDOS"] or 0)
    return det


def montar(det):
    muns = sorted({(uf, mun) for (t, uf, mun, z) in det})
    idx = {m: i for i, m in enumerate(muns)}
    ufs = sorted({uf for uf, _ in muns})
    regs = sorted(set(REGIAO.values()))
    n = len(muns)
    b1 = defaultdict(lambda: defaultdict(int))
    for (t, uf, mun, z), v in det.items():
        if t == "1":
            for kk, x in v.items():
                b1[(uf, mun)][kk] += x
    base_l = np.zeros(n); base_o = np.zeros(n); base_lb = np.zeros(n); base_comp = np.zeros(n); base_valid = np.zeros(n)
    for m, i in idx.items():
        v = b1[m]
        vv = max(v["vv"], 1)
        base_l[i] = v["lula"] / vv
        base_o[i] = v["outros"] / vv
        base_lb[i] = v["lula"] / max(v["lula"] + v["bolso"], 1)
        base_comp[i] = v["comp"] / max(v["aptos"], 1)
        base_valid[i] = v["vv"] / max(v["comp"], 1)
    zonas = [(uf, mun, z, v) for (t, uf, mun, z), v in det.items() if t == "2"]
    grupo = np.array([ufs.index(uf) for uf, _ in muns])
    regiao = np.array([regs.index(REGIAO[uf]) for uf, _ in muns])
    te = np.zeros(n)
    for uf, mun, z, v in zonas:
        te[idx[(uf, mun)]] += v["aptos"]
    real = sum(v["lula"] for *_, v in zonas) / sum(v["vv"] for *_, v in zonas)
    return dict(muns=muns, idx=idx, ufs=ufs, grupo=grupo, regiao=regiao, te=te, zonas=zonas, base_l=base_l,
                base_o=base_o, base_lb=base_lb, base_comp=base_comp, base_valid=base_valid, real=real)


def ordens(M, rng_seeds):
    zonas = M["zonas"]
    ordem_reg = {"Sul": 0, "Sudeste": 1, "Centro-Oeste": 2, "Exterior": 3, "Norte": 4, "Nordeste": 5}
    out = {}
    for s in rng_seeds:
        r = np.random.default_rng(s)
        out[f"aleatoria_{s}"] = list(r.permutation(len(zonas)))
    r = np.random.default_rng(99)
    ruido = r.random(len(zonas))
    out["sul_primeiro"] = sorted(range(len(zonas)), key=lambda i: (ordem_reg[REGIAO[zonas[i][0]]], ruido[i]))
    out["nordeste_primeiro"] = sorted(range(len(zonas)), key=lambda i: (-ordem_reg[REGIAO[zonas[i][0]]], ruido[i]))
    # municípios pequenos apuram antes, capitais e exterior por último (padrão real das noites de apuração)
    tam = {m: M["te"][i] for m, i in M["idx"].items()}
    out["pequenos_primeiro"] = sorted(range(len(zonas)),
                                      key=lambda i: (zonas[i][0] == "zz", np.log(tam[(zonas[i][0], zonas[i][1])]) + 2 * ruido[i]))
    return out


def unidades_em(M, ordem, frac, variante):
    n = len(M["muns"])
    est = np.zeros(n); c = np.zeros(n); vv = np.zeros(n); lula = np.zeros(n)
    alvo = frac * M["te"].sum()
    acum = 0.0
    for i in ordem:
        uf, mun, z, v = M["zonas"][i]
        if acum >= alvo:
            break
        j = M["idx"][(uf, mun)]
        est[j] += v["aptos"]; c[j] += v["comp"]; vv[j] += v["vv"]; lula[j] += v["lula"]
        acum += v["aptos"]
    if variante == "transferencia":
        bl, bo = M["base_l"], M["base_o"]
    else:
        bl, bo = M["base_lb"], np.zeros(n)
    return Unidades(grupo=M["grupo"], regiao=M["regiao"], te=M["te"], est=est, c=c, vv=vv, lula=lula,
                    base_l=bl, base_o=bo, base_comp=M["base_comp"], base_valid=M["base_valid"], nomes_grupo=M["ufs"])


def main():
    rapido = "--rapido" in sys.argv
    for a in sys.argv[1:]:
        if a.startswith("--tau="):
            projecao.FATOR_TAU = float(a.split("=")[1])
        if a.startswith("--parcial="):
            projecao.FATOR_PARCIAL = float(a.split("=")[1])
    M = montar(ler_zonas())
    real = 100 * M["real"]
    print(f"real 2022 2T: Lula {real:.3f}%  municípios {len(M['muns'])}  zonas {len(M['zonas'])}")
    ords = ordens(M, range(1, 4 if rapido else 9))
    nb = 100 if rapido else 200
    res = defaultdict(list)
    for variante in ("transferencia", "swing"):
        for nome, ordem in ords.items():
            linha = []
            for f in FRACOES:
                p = projetar(unidades_em(M, ordem, f, variante), n_boot=nb, seed=1)
                err = p["lula_pct"] - real
                cobre = p["p10"] <= real <= p["p90"]
                res[(variante, f)].append((abs(err), cobre))
                linha.append(f"{err:+.2f}{'' if cobre else '*'}")
            print(f"{variante:14s} {nome:18s} " + " ".join(f"{x:>7s}" for x in linha))
    print("\nfração  variante        erro_med  erro_max  ≤1,5pp  ≤0,7pp  cobertura_p10_p90")
    for (variante, f), v in sorted(res.items(), key=lambda x: (x[0][0], x[0][1])):
        e = np.array([x[0] for x in v]); cob = np.mean([x[1] for x in v])
        print(f"{f:5.2f}  {variante:14s} {e.mean():8.2f}  {e.max():8.2f}  {np.mean(e <= 1.5):6.0%}  {np.mean(e <= 0.7):6.0%}  {cob:6.0%}")
    ok30 = all(np.mean(np.array([x[0] for x in res[(v, 0.3)]]) <= 1.5) >= 0.8 for v in ("transferencia", "swing"))
    ok60 = all(np.mean(np.array([x[0] for x in res[(v, 0.6)]]) <= 0.7) >= 0.8 for v in ("transferencia", "swing"))
    print(f"\ncritério 30%: {'PASSOU' if ok30 else 'FALHOU'}   critério 60%: {'PASSOU' if ok60 else 'FALHOU'}")
    sys.exit(0 if ok30 and ok60 else 1)


if __name__ == "__main__":
    main()
