"""Comparação 2022 × 1º turno 2026 × agora, somada por estado, para o filtro de estados e regiões do painel.

Tudo é calculado nas MESMAS urnas: para cada município, a fração já apurada (eleitores apurados / eleitorado)
é aplicada ao resultado dele no 2º turno de 2022 e no 1º turno de 2026. Como as contas são somas, o navegador
junta os estados que a pessoa escolher sem pedir nada ao servidor.

Vetor por estado (VETOR): eleitores apurados, Lula, Flávio e comparecimento de agora; Lula, Bolsonaro,
comparecimento e aptos de 2022 nas mesmas urnas; Lula, Flávio, 3ª via e comparecimento do 1º turno nas mesmas
urnas. No 1º turno a 3ª via fica no denominador (percentual sobre todos os válidos).

A curva da noite vem da mun_hist (cada leitura de município em que o número de seções mudou) e dos BUs do
exterior, na hora do TSE, com um ponto por minuto, enxugada para no máximo ~MAX_PONTOS pontos e mandada só com
os estados que mudaram em cada ponto.
"""

from __future__ import annotations

import numpy as np

from . import tse

VETOR = ["est", "lula", "flavio", "comp", "l22", "b22", "c22", "a22", "l1", "f1", "o1", "c1"]
PASSO_PP = 1.5      # um ponto novo na curva quando algum estado anda ao menos 1,5 pp de apurado
SERIE = [0, 1, 2, 4, 5, 8, 9, 10]  # a curva só leva eleitores apurados e votos (sem comparecimento e aptos)
MAX_PONTOS = 160
_CACHE: dict = {"chave": None, "serie": []}


def _tse_iso(dg: str | None, hg: str | None, fallback: str) -> str:
    """dd/mm/aaaa + hh:mm:ss (hora de Brasília do arquivo do TSE) → ISO; sem isso, a hora da coleta."""
    if dg and hg and len(dg) >= 10 and len(hg) >= 5:
        return f"{dg[6:10]}-{dg[3:5]}-{dg[0:2]}T{hg[:8]}"
    return fallback or ""


def _base(ctx) -> np.ndarray:
    """n × 8: 2022 (Lula, Bolsonaro, comparecimento, aptos) e 1º turno 2026 (Lula, Flávio, 3ª via, comparecimento)."""
    a, b = ctx.B["2022_2t"], ctx.B["2026_1t"]
    return np.c_[a["lula"], a["direita"], a["comparecimento"], a["aptos"],
                 b["lula"], b["direita"], b["outros"], b["comparecimento"]].astype(float)


def _te(ctx) -> np.ndarray:
    """Eleitorado de cada município, como em Ctx.unidades: o do arquivo -ab ou, sem ele, os aptos do 1º turno."""
    b1 = ctx.B["2026_1t"]
    return np.array([float((ctx.ab.get(k) or {}).get("eleitorado") or b1["aptos"][i]) for i, k in enumerate(ctx.chaves)])


def _incidencia(ctx) -> np.ndarray:
    """Matriz estado × município (28 × n) para somar por estado com um produto."""
    G = np.zeros((len(tse.UFS) + 1, len(ctx.chaves)))
    G[ctx.grupo, np.arange(len(ctx.chaves))] = 1.0
    return G


def vetores(G: np.ndarray, base: np.ndarray, te: np.ndarray, est, lula, vv, comp) -> np.ndarray:
    """Soma por estado (28 × len(VETOR)) do estado atual dos municípios, com as bases na fração apurada."""
    est = np.minimum(np.asarray(est, float), te)
    f = np.where(te > 0, est / np.where(te > 0, te, 1), 0.0)
    M = np.c_[est, lula, np.asarray(vv, float) - np.asarray(lula, float), comp, f[:, None] * base]
    return G @ M


def _eventos(ctx) -> list[tuple]:
    """(hora TSE, índice do município, fonte, eleitores apurados, comparecimento, válidos, Lula).
    fonte 0 = totalização oficial (mun_hist); 1 = soma dos BUs da cidade do exterior."""
    ev = []
    for r in ctx.db.query("SELECT uf, mun, dg, hg, ts_coleta, eleitorado_apur, comparecimento, validos, lula "
                          "FROM mun_hist ORDER BY rowid"):
        i = ctx.idx.get((r["uf"], r["mun"]))
        if i is None:
            continue
        ev.append((_tse_iso(r["dg"], r["hg"], r["ts_coleta"]), i, 0, r["eleitorado_apur"] or 0,
                   r["comparecimento"] or 0, r["validos"] or 0, r["lula"] or 0))
    from .painel import _quando  # import tardio: painel importa este módulo
    acum: dict[str, list] = {}
    for r in ctx.bu_rows:
        i = ctx.idx.get(("zz", r["mun"]))
        if i is None:
            continue
        a = acum.setdefault(r["mun"], [0, 0, 0, 0])
        a[0] += r["aptos"] or 0; a[1] += r["comparecimento"] or 0
        a[2] += (r["lula"] or 0) + (r["flavio"] or 0); a[3] += r["lula"] or 0
        ev.append((_quando(r), i, 1, *a))
    ev.sort(key=lambda e: e[0])  # estável: dentro do mesmo instante, a ordem de leitura
    return ev


def serie(ctx, G: np.ndarray, base: np.ndarray, te: np.ndarray) -> list[list]:
    """Curva da noite: [[hora "hh:mm", [[estado, *vetor[SERIE]], ...só os que mudaram]], ...]."""
    ev = _eventos(ctx)
    n = len(ctx.chaves)
    of, bu = np.zeros((n, 4)), np.zeros((n, 4))
    te_uf = G @ te
    pontos, ultimo, ap_ult = [], None, np.zeros(G.shape[0])
    k = 0
    while k < len(ev):
        minuto = ev[k][0][:16]
        while k < len(ev) and ev[k][0][:16] == minuto:
            _, i, fonte, *v = ev[k]
            (bu if fonte else of)[i] = v
            k += 1
        # exterior: BU e totalização convivem; vale a que cobre mais eleitorado (como em Ctx.unidades)
        e = of.copy()
        usa_bu = bu[:, 0] > of[:, 0]
        e[usa_bu] = bu[usa_bu]
        V = vetores(G, base, te, e[:, 0], e[:, 3], e[:, 2], e[:, 1])
        ap = np.where(te_uf > 0, 100 * V[:, 0] / np.where(te_uf > 0, te_uf, 1), 0)
        fim = k >= len(ev)
        if not fim and np.all(ap - ap_ult < PASSO_PP):
            continue
        ap_ult = ap
        V = np.rint(V[:, SERIE]).astype(np.int64)
        mud = [g for g in range(G.shape[0]) if V[g, 0] > 0 and (ultimo is None or not np.array_equal(V[g], ultimo[g]))]
        if mud:
            pontos.append([minuto[11:16], [[g, *V[g].tolist()] for g in mud]])
        ultimo = V
    if len(pontos) > MAX_PONTOS:  # noite longa: junta pontos seguidos, guardando sempre o último
        passo = len(pontos) / MAX_PONTOS
        keep = sorted({int(j * passo) for j in range(MAX_PONTOS)} | {len(pontos) - 1})
        out, acc = [], {}
        j0 = 0
        for j in keep:
            for p in pontos[j0:j + 1]:
                for linha in p[1]:
                    acc[linha[0]] = linha
            out.append([pontos[j][0], list(acc.values())])
            acc, j0 = {}, j + 1
        pontos = out
    return pontos


def montar(ctx, u) -> dict:
    """Estrutura do /api/comparacao. u: Unidades do Brasil inteiro (com exterior) já montadas pelo painel."""
    G, base, te = _incidencia(ctx), _base(ctx), _te(ctx)
    try:
        sig = ctx.db.one("SELECT max(rowid) r, count(*) n FROM mun_hist") or {}
    except Exception:  # noqa: BLE001 - banco antigo
        sig = {}
    chave = (sig.get("r"), sig.get("n"), len(ctx.bu_rows), len(ctx.chaves))
    if chave != _CACHE["chave"]:
        _CACHE.update(chave=chave, serie=serie(ctx, G, base, te))
    agora = np.rint(vetores(G, base, te, u.est, u.lula, u.vv, u.c)).astype(np.int64)
    a22, b1 = ctx.B["2022_2t"], ctx.B["2026_1t"]
    fim22 = np.rint(G @ np.c_[a22["lula"], a22["direita"], a22["comparecimento"], a22["aptos"]]).astype(np.int64)
    fim1 = np.rint(G @ np.c_[b1["lula"], b1["direita"], b1["outros"], b1["comparecimento"], b1["aptos"]]).astype(np.int64)
    ufs = tse.UFS + ["zz"]
    return {
        "ufs": ufs, "regiao": [tse.REGIAO[x] for x in ufs], "campos": VETOR,
        "campos_serie": [VETOR[i] for i in SERIE],
        "eleitorado": np.rint(G @ te).astype(np.int64).tolist(),
        "agora": agora.tolist(),
        "final_2022": fim22.tolist(), "final_1t": fim1.tolist(),
        "serie": _CACHE["serie"],
    }
