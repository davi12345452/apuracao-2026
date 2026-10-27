"""Decomposição do crescimento (3ª via e votos válidos novos) com dados sintéticos de resposta conhecida."""

import numpy as np

from apuracao.painel import _decompor


def sintetico(n=600, seed=0, a=(0.7, 0.3), b=(0.6, 0.4)):
    """1º turno com 3ª via e brancos/nulos; no 2º turno a 3ª via se divide por a e os válidos novos
    (Δcomparecimento + brancos/nulos que viraram voto) por b."""
    rng = np.random.default_rng(seed)
    A1 = rng.integers(500, 50_000, n).astype(float)
    C1 = A1 * rng.uniform(0.7, 0.85, n)
    B1 = C1 * rng.uniform(0.03, 0.08, n)
    O1 = C1 * rng.uniform(0.03, 0.2, n)
    L1 = (C1 - B1 - O1) * rng.uniform(0.3, 0.7, n)
    F1 = C1 - B1 - O1 - L1
    dC = A1 * rng.uniform(-0.03, 0.06, n)
    BN = B1 * rng.uniform(0.1, 0.5, n)  # brancos/nulos do 1º turno que viram voto
    V = dC + BN
    L2, F2 = L1 + a[0] * O1 + b[0] * V, F1 + a[1] * O1 + b[1] * V
    return L2, F2, C1 + dC, A1.copy(), B1 - BN, L1, F1, C1, A1, B1


def test_recupera_as_fatias():
    X = sintetico()
    r = _decompor(*X, np.array(["x"] * len(X[0])), {}, n_boot=20)
    L, F = r["candidatos"]["lula"], r["candidatos"]["flavio"]
    assert abs(L["fatia_3via"] - 70) < 0.5 and abs(F["fatia_3via"] - 30) < 0.5
    assert abs(L["fatia_novos"] - 60) < 0.5 and abs(F["fatia_novos"] - 40) < 0.5


def test_fatias_somam_100_mesmo_com_ruido():
    """A identidade ΔLula + ΔFlávio = 3ª via + válidos novos garante a soma, com qualquer ruído por unidade."""
    L2, F2, C2, A2, B2, L1, F1, C1, A1, B1 = sintetico(seed=3)
    ruido = np.random.default_rng(1).normal(0, 0.05, len(L2)) * (L2 - L1)
    r = _decompor(L2 + ruido, F2 - ruido, C2, A2, B2, L1, F1, C1, A1, B1, np.array(["x"] * len(L2)), {}, n_boot=20)
    L, F = r["candidatos"]["lula"], r["candidatos"]["flavio"]
    for k in ("fatia_3via", "fatia_novos"):
        assert abs(L[k] + F[k] - 100) < 0.2
    assert abs(r["d_validos_novos"] - (r["d_comparecimento"] - r["d_brancos_nulos"])) <= 2
