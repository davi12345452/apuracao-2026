"""Projeção do resultado final a partir da apuração parcial, por município.

Ideia: cada município (ou cidade do exterior) tem uma base — o que se espera da fatia de Lula entre
os votos válidos e do comparecimento, vinda de uma eleição anterior. Nos municípios já apurados
mede-se o desvio em relação à base (swing). O que falta apurar recebe:

- municípios parciais: a fatia e o comparecimento observados no próprio município;
- municípios sem nada: base + swing médio da UF (encolhido para a região e para o Brasil
  quando a UF tem poucos votos apurados), e o comparecimento da base ajustado pela razão da UF.

Duas bases:

- "2022": fatia de Lula no 2º turno de 2022 (Lula / (Lula + Bolsonaro)).
- "2026_1t": fatia de Lula no 1º turno de 2026 + α × fatia dos outros candidatos, com α (quanto
  dos votos dos outros vai para Lula) estimado por região nos municípios já apurados.

A faixa de incerteza vem de um bootstrap bayesiano dos municípios apurados (pesos exponenciais)
mais um choque por UF proporcional ao que a UF ainda não apurou (τ calibrado no backtest de 2022).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

K_ENCOLHE = 100_000  # votos válidos: abaixo disso a UF puxa forte para a média da região
TAU_MIN = 0.02  # choque mínimo por UF (fração), calibrado no backtest
MIN_APURADO = 0.05
FATOR_TAU = 2.0  # multiplica o choque por UF; calibrado no backtest de 2022
FATOR_PARCIAL = 1.0  # parte do choque aplicada às seções restantes de municípios parciais


@dataclass
class Unidades:
    """Vetores alinhados, um item por município/cidade."""

    grupo: np.ndarray  # índice da UF (inteiro)
    regiao: np.ndarray  # índice da região (inteiro)
    te: np.ndarray  # eleitorado total
    est: np.ndarray  # eleitorado das seções já apuradas
    c: np.ndarray  # comparecimento apurado
    vv: np.ndarray  # válidos apurados (Lula + adversário)
    lula: np.ndarray  # votos de Lula apurados
    base_l: np.ndarray  # fatia de Lula na base (entre válidos)
    base_o: np.ndarray  # fatia dos "outros" na base (0 na base de 2º turno)
    base_comp: np.ndarray  # comparecimento / eleitorado na base
    base_valid: np.ndarray  # válidos / comparecimento na base
    nomes_grupo: list[str] = field(default_factory=list)


def _media_pond(x: np.ndarray, w: np.ndarray, g: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    sw = np.bincount(g, weights=w, minlength=n)
    sx = np.bincount(g, weights=w * x, minlength=n)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(sw > 0, sx / np.where(sw > 0, sw, 1), 0.0), sw


def _encolher(x_g, w_g, x_pai, k):
    return (w_g * x_g + k * x_pai) / (w_g + k)


def _swing_hier(d, w, grupo, regiao, n_g, n_r, k=K_ENCOLHE):
    """Swing por UF encolhido para região, que é encolhida para o Brasil."""
    tot_w = w.sum()
    nac = (w * d).sum() / tot_w if tot_w > 0 else 0.0
    reg_x, reg_w = _media_pond(d, w, regiao, n_r)
    reg = _encolher(reg_x, reg_w, nac, k)
    g_x, g_w = _media_pond(d, w, grupo, n_g)
    # região de cada grupo: pega a primeira ocorrência
    reg_de_g = np.zeros(n_g, dtype=int)
    reg_de_g[grupo] = regiao
    return _encolher(g_x, g_w, reg[reg_de_g], k), g_w


def _alpha(u: Unidades, rep: np.ndarray, w: np.ndarray, n_r: int) -> np.ndarray:
    """α por região: s ≈ l + α·o, mínimos quadrados ponderados sem intercepto."""
    s = np.where(u.vv > 0, u.lula / np.where(u.vv > 0, u.vv, 1), 0)
    y = (s - u.base_l) * rep
    x = u.base_o * rep
    num = np.bincount(u.regiao, weights=w * x * y, minlength=n_r)
    den = np.bincount(u.regiao, weights=w * x * x, minlength=n_r)
    nac = (w * x * y).sum() / max((w * x * x).sum(), 1e-12)
    # encolhe α regional para o nacional (den tem escala de votos × fração²)
    k = K_ENCOLHE * 0.01
    a = (num + k * nac) / (den + k)
    return np.clip(a, 0.0, 1.0)


def projetar(u: Unidades, n_boot: int = 300, seed: int = 0, tau: float | None = None) -> dict:
    n_g = int(u.grupo.max()) + 1
    n_r = int(u.regiao.max()) + 1
    rep = u.vv > 0
    apurado = u.est.sum() / u.te.sum() if u.te.sum() else 0.0
    out: dict = {"apurado_eleitorado": float(apurado), "disponivel": bool(apurado >= MIN_APURADO and rep.any())}
    if not rep.any():
        return out

    w = np.where(rep, u.vv, 0).astype(float)
    alpha = None
    base = u.base_l.copy()
    if np.any(u.base_o > 0):
        alpha = _alpha(u, rep, w, n_r)
        base = np.clip(u.base_l + alpha[u.regiao] * u.base_o, 0, 1)

    s = np.where(rep, u.lula / np.where(rep, u.vv, 1), 0.0)
    d = np.where(rep, s - base, 0.0)

    # comparecimento e taxa de válidos: razão observada / base, por UF
    with np.errstate(invalid="ignore", divide="ignore"):
        comp_obs = np.where(u.est > 0, u.c / np.where(u.est > 0, u.est, 1), 0)
        val_obs = np.where(u.c > 0, u.vv / np.where(u.c > 0, u.c, 1), 0)
        r_comp = np.where(rep & (u.base_comp > 0), comp_obs / np.where(u.base_comp > 0, u.base_comp, 1), 1.0)
        r_val = np.where(rep & (u.base_valid > 0), val_obs / np.where(u.base_valid > 0, u.base_valid, 1), 1.0)
    w_est = np.where(rep, u.est, 0).astype(float)
    rc_g, _ = _swing_hier(r_comp - 1, w_est, u.grupo, u.regiao, n_g, n_r, k=K_ENCOLHE * 1.3)
    rv_g, _ = _swing_hier(r_val - 1, w, u.grupo, u.regiao, n_g, n_r)

    resto = np.clip(u.te - u.est, 0, None).astype(float)
    comp_rest = np.where(rep, comp_obs, np.clip(u.base_comp * (1 + rc_g[u.grupo]), 0, 1))
    val_rest = np.where(rep, val_obs, np.clip(u.base_valid * (1 + rv_g[u.grupo]), 0, 1))
    c_rest = resto * comp_rest
    vv_rest = c_rest * val_rest

    sw_g, w_g = _swing_hier(d, w, u.grupo, u.regiao, n_g, n_r)
    share_rest = np.where(rep, s, np.clip(base + sw_g[u.grupo], 0, 1))

    lula_fin = u.lula.sum() + (vv_rest * share_rest).sum()
    vv_fin = u.vv.sum() + vv_rest.sum()
    c_fin = u.c.sum() + c_rest.sum()
    p50 = lula_fin / vv_fin

    # incerteza: bootstrap bayesiano dos apurados + choque por UF no que falta
    te_g = np.bincount(u.grupo, weights=u.te, minlength=n_g)
    est_g = np.bincount(u.grupo, weights=u.est, minlength=n_g)
    falta_g = np.where(te_g > 0, 1 - est_g / np.where(te_g > 0, te_g, 1), 0)
    if tau is None:
        tem = w_g > 0
        dev = sw_g[tem] - (w_g[tem] * sw_g[tem]).sum() / w_g[tem].sum() if tem.any() else np.zeros(1)
        tau = max(TAU_MIN, float(np.sqrt((w_g[tem] * dev**2).sum() / w_g[tem].sum())) if tem.any() else TAU_MIN)
        tau *= FATOR_TAU
    rng = np.random.default_rng(seed)
    sem_rep = ~rep
    sims = np.empty(n_boot)
    for b in range(n_boot):
        wb = w * rng.exponential(size=w.size)
        swb, _ = _swing_hier(d, wb, u.grupo, u.regiao, n_g, n_r)
        choque = rng.normal(0, tau, n_g) * np.sqrt(falta_g)
        sh = np.where(sem_rep, np.clip(base + swb[u.grupo] + choque[u.grupo], 0, 1), s)
        # municípios parciais também recebem parte do choque (seções restantes podem diferir)
        sh = np.where(rep, np.clip(s + choque[u.grupo] * FATOR_PARCIAL, 0, 1), sh)
        sims[b] = (u.lula.sum() + (vv_rest * sh).sum()) / vv_fin

    out.update({
        "lula_pct": float(100 * p50),
        "flavio_pct": float(100 - 100 * p50),
        "p10": float(100 * np.quantile(sims, 0.1)),
        "p90": float(100 * np.quantile(sims, 0.9)),
        "prob_lula": float(100 * (sims > 0.5).mean()),
        "validos_final": float(vv_fin),
        "comparecimento_final": float(c_fin),
        "abstencao_final_pct": float(100 * (1 - c_fin / u.te.sum())),
        "margem_votos": float(lula_fin - (vv_fin - lula_fin)),
        "tau": float(tau),
        "swing_uf": {u.nomes_grupo[i] if u.nomes_grupo else str(i): float(100 * sw_g[i]) for i in range(n_g) if w_g[i] > 0},
    })
    if alpha is not None:
        out["alpha_regiao"] = [float(100 * a) for a in alpha]
    return out
