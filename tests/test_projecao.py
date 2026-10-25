"""Matemática da projeção com dados sintéticos de resposta conhecida."""

import numpy as np

from apuracao.projecao import Unidades, projetar


def sintetico(n=400, n_uf=8, swing=0.03, alpha=None, seed=0):
    rng = np.random.default_rng(seed)
    grupo = np.arange(n) % n_uf
    regiao = grupo // 2
    te = rng.integers(2_000, 200_000, n).astype(float)
    base_comp = rng.uniform(0.7, 0.85, n)
    base_valid = rng.uniform(0.9, 0.96, n)
    if alpha is None:
        base_l = rng.uniform(0.25, 0.75, n)
        base_o = np.zeros(n)
        verdade = np.clip(base_l + swing, 0, 1)
    else:
        base_l = rng.uniform(0.2, 0.6, n)
        base_o = rng.uniform(0.05, 0.2, n)
        verdade = np.clip(base_l + alpha * base_o + swing, 0, 1)
    vv_tot = te * base_comp * base_valid
    return dict(grupo=grupo, regiao=regiao, te=te, base_comp=base_comp, base_valid=base_valid,
                base_l=base_l, base_o=base_o, verdade=verdade, vv_tot=vv_tot)


def apurar(s, frac_mask):
    """Municípios em frac_mask apurados por inteiro; o resto zerado."""
    m = frac_mask.astype(float)
    return Unidades(grupo=s["grupo"], regiao=s["regiao"], te=s["te"], est=s["te"] * m,
                    c=s["te"] * s["base_comp"] * m, vv=s["vv_tot"] * m, lula=s["vv_tot"] * s["verdade"] * m,
                    base_l=s["base_l"], base_o=s["base_o"], base_comp=s["base_comp"], base_valid=s["base_valid"])


def real(s):
    return 100 * (s["vv_tot"] * s["verdade"]).sum() / s["vv_tot"].sum()


def test_swing_uniforme_recupera_resultado():
    s = sintetico(swing=0.03)
    mask = np.random.default_rng(1).random(400) < 0.3
    p = projetar(apurar(s, mask), n_boot=50)
    assert p["disponivel"]
    assert abs(p["lula_pct"] - real(s)) < 0.05
    assert p["p10"] <= real(s) <= p["p90"]


def test_tudo_apurado_e_exato():
    s = sintetico(swing=-0.02)
    p = projetar(apurar(s, np.ones(400, dtype=bool)), n_boot=20)
    assert abs(p["lula_pct"] - real(s)) < 1e-9
    assert abs(p["p90"] - p["p10"]) < 1e-9
    assert abs(p["abstencao_final_pct"] - 100 * (1 - (s["te"] * s["base_comp"]).sum() / s["te"].sum())) < 1e-9


def test_transferencia_recupera_alpha():
    s = sintetico(swing=0.0, alpha=0.6)
    mask = np.random.default_rng(2).random(400) < 0.4
    p = projetar(apurar(s, mask), n_boot=30)
    assert all(abs(a - 60) < 1 for a in p["alpha_regiao"])
    assert abs(p["lula_pct"] - real(s)) < 0.1


def test_nada_apurado_nao_projeta():
    s = sintetico()
    p = projetar(apurar(s, np.zeros(400, dtype=bool)))
    assert not p["disponivel"] and "lula_pct" not in p


def test_pouco_apurado_fica_indisponivel_mas_calcula():
    s = sintetico()
    mask = np.zeros(400, dtype=bool)
    mask[np.argsort(s["te"])[:5]] = True  # cinco menores municípios: < 5% do eleitorado
    p = projetar(apurar(s, mask), n_boot=20)
    assert not p["disponivel"] and "lula_pct" in p


def test_probabilidade_coerente_com_lado():
    s = sintetico(swing=0.15)
    mask = np.random.default_rng(3).random(400) < 0.5
    p = projetar(apurar(s, mask), n_boot=50)
    assert real(s) > 55 and p["prob_lula"] > 99
    s = sintetico(swing=-0.15)
    p = projetar(apurar(s, mask), n_boot=50)
    assert real(s) < 45 and p["prob_lula"] < 1
