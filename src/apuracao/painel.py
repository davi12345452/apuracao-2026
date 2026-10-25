"""Monta o estado do painel a partir do SQLite: placar, exterior, comparações e projeções."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

import numpy as np

from . import tse
from .db import DB
from .projecao import Unidades, projetar

REGIOES = sorted(set(tse.REGIAO.values()))
UFS_TODAS = tse.UFS + ["zz"]


def _pct(a, b):
    return round(100 * a / b, 3) if b else None


def _bases(db: DB) -> dict[str, dict[tuple[str, str], dict]]:
    out: dict[str, dict] = defaultdict(dict)
    for r in db.query("SELECT * FROM base"):
        out[r["fonte"]][(r["uf"], r["mun"])] = r
    return out


def _exterior_bu(db: DB) -> dict[str, dict]:
    """Totais por cidade do exterior somando os BUs baixados."""
    rows = db.query(
        "SELECT mun, count(*) secoes, sum(aptos) est, sum(comparecimento) c, sum(lula) lula, sum(flavio) flavio, "
        "sum(brancos) brancos, sum(nulos) nulos, max(baixado_em) ultimo FROM bu GROUP BY mun"
    )
    return {r["mun"]: r for r in rows}


def unidades_atuais(db: DB, bases: dict, fonte_base: str, ext_bu: dict | None = None) -> tuple[Unidades, list]:
    """Vetores da projeção. Municípios: 1º turno 2026 (cadastro completo, inclui exterior)."""
    ext_bu = ext_bu if ext_bu is not None else _exterior_bu(db)
    chaves = sorted(bases["2026_1t"])
    mun = {(r["uf"], r["mun"]): r for r in db.query("SELECT * FROM mun")}
    ab = {(r["uf"], r["mun"]): r for r in db.query("SELECT * FROM mun_ab")}
    b = bases[fonte_base]
    b1 = bases["2026_1t"]
    n = len(chaves)
    arr = {k: np.zeros(n) for k in ("te", "est", "c", "vv", "lula", "base_l", "base_o", "base_comp", "base_valid")}
    tem_base = np.zeros(n, dtype=bool)
    grupo = np.array([UFS_TODAS.index(uf) for uf, _ in chaves])
    regiao = np.array([REGIOES.index(tse.REGIAO[uf]) for uf, _ in chaves])
    for i, k in enumerate(chaves):
        m, a, bb = mun.get(k), ab.get(k), b.get(k)
        arr["te"][i] = (a or {}).get("eleitorado") or b1[k]["aptos"]
        e_bu = ext_bu.get(k[1]) if k[0] == "zz" else None
        # exterior: BU e totalização oficial convivem depois das 17h; vale a que cobre mais eleitorado
        if m and m["secoes_apur"] and (not e_bu or m["eleitorado_apur"] >= e_bu["est"]):
            arr["est"][i], arr["c"][i] = m["eleitorado_apur"], m["comparecimento"]
            arr["vv"][i], arr["lula"][i] = m["validos"], m["lula"]
        elif e_bu:
            e = ext_bu[k[1]]
            arr["est"][i], arr["c"][i] = e["est"], e["c"]
            arr["vv"][i], arr["lula"][i] = e["lula"] + e["flavio"], e["lula"]
        if bb and bb["validos"] and bb["comparecimento"] and bb["aptos"]:
            tem_base[i] = True
            if fonte_base == "2022_2t":
                arr["base_l"][i] = bb["lula"] / max(bb["lula"] + bb["direita"], 1)
            else:
                arr["base_l"][i] = bb["lula"] / bb["validos"]
                arr["base_o"][i] = bb["outros"] / bb["validos"]
            arr["base_comp"][i] = bb["comparecimento"] / bb["aptos"]
            arr["base_valid"][i] = bb["validos"] / bb["comparecimento"]
    # sem base (cidade nova no exterior etc.): média ponderada da UF
    for g in np.unique(grupo[~tem_base]):
        sel = (grupo == g) & tem_base
        w = arr["te"][sel]
        for campo in ("base_l", "base_o", "base_comp", "base_valid"):
            v = float((arr[campo][sel] * w).sum() / w.sum()) if sel.any() and w.sum() else 0.5
            arr[campo][(grupo == g) & ~tem_base] = v
    # exterior: o eleitorado apurado pode passar do cadastro quando há seção agregada; corta
    arr["est"] = np.minimum(arr["est"], arr["te"])
    return Unidades(grupo=grupo, regiao=regiao, nomes_grupo=UFS_TODAS, **arr), chaves


def comparacao_mesmas_urnas(u: Unidades, chaves: list, bases: dict, mask=None) -> dict:
    """Mesmos municípios, na mesma proporção apurada: o que a base tinha ali."""
    f = np.where(u.te > 0, u.est / np.where(u.te > 0, u.te, 1), 0)
    if mask is not None:
        f = f * mask
    out = {"lula": float((u.lula * (mask if mask is not None else 1)).sum()),
           "validos": float((u.vv * (mask if mask is not None else 1)).sum()),
           "comparecimento": float((u.c * (mask if mask is not None else 1)).sum()),
           "eleitorado": float((u.est * (mask if mask is not None else 1)).sum())}
    out["flavio"] = out["validos"] - out["lula"]
    out["lula_pct"] = _pct(out["lula"], out["validos"])
    out["abstencao_pct"] = _pct(out["eleitorado"] - out["comparecimento"], out["eleitorado"])
    for fonte in ("2026_1t", "2022_1t", "2022_2t"):
        b = bases.get(fonte, {})
        L = D = O = V = C = A = 0.0
        for i, k in enumerate(chaves):
            if f[i] <= 0 or k not in b:
                continue
            r = b[k]
            L += f[i] * r["lula"]; D += f[i] * r["direita"]; O += f[i] * r["outros"]
            V += f[i] * r["validos"]; C += f[i] * r["comparecimento"]; A += f[i] * r["aptos"]
        out[fonte] = {
            "lula": round(L), "direita": round(D), "outros": round(O), "validos": round(V),
            "lula_pct": _pct(L, V), "direita_pct": _pct(D, V), "lula_2v_pct": _pct(L, L + D),
            "abstencao_pct": _pct(A - C, A), "comparecimento": round(C),
        }
    return out


def _serie(db: DB, abr: str) -> list[dict]:
    rows = db.query("SELECT * FROM snap WHERE abr=? AND secoes_apur > 0 ORDER BY ts_coleta", (abr,))
    return [{
        "t": r["ts_coleta"], "hg": r["hg"], "apurado": _pct(r["secoes_apur"], r["secoes_tot"]),
        "lula_pct": _pct(r["lula"], r["validos"]), "lula": r["lula"], "flavio": r["flavio"],
        "abstencao_pct": _pct(r["abstencao"], r["comparecimento"] + r["abstencao"]),
    } for r in rows]


def _snap(db: DB, abr: str) -> dict | None:
    r = db.one("SELECT * FROM snap WHERE abr=? ORDER BY ts_coleta DESC LIMIT 1", (abr,))
    if not r:
        return None
    r["apurado_pct"] = _pct(r["secoes_apur"], r["secoes_tot"])
    r["lula_pct"] = _pct(r["lula"], r["validos"])
    r["flavio_pct"] = _pct(r["flavio"], r["validos"])
    r["abstencao_pct"] = _pct(r["abstencao"], r["comparecimento"] + r["abstencao"])
    r["brancos_pct"] = _pct(r["brancos"], r["comparecimento"])
    r["nulos_pct"] = _pct(r["nulos"], r["comparecimento"])
    return r


def exterior(db: DB, bases: dict, ext_bu: dict) -> dict:
    nomes = {r["mun"]: r for r in db.query("SELECT * FROM municipio WHERE uf='zz'")}
    tot_sec = db.query("SELECT mun, count(*) n FROM secao_ext GROUP BY mun")
    sec_cidade = {r["mun"]: r["n"] for r in tot_sec}
    paises: dict[str, dict] = {}
    for mun, nsec in sec_cidade.items():
        info = nomes.get(mun, {})
        p = paises.setdefault(info.get("pais") or "?", defaultdict(float, pais=info.get("pais") or "?", iso3=info.get("iso3") or ""))
        p["secoes_tot"] += nsec
        e = ext_bu.get(mun)
        if not e:
            continue
        p["secoes"] += e["secoes"]; p["est"] += e["est"]; p["c"] += e["c"]
        p["lula"] += e["lula"]; p["flavio"] += e["flavio"]
        # base da cidade proporcional às seções já apuradas
        frac = e["secoes"] / nsec
        for fonte in ("2026_1t", "2022_2t"):
            r = bases[fonte].get(("zz", mun))
            if r:
                p[f"{fonte}_lula"] += frac * r["lula"]; p[f"{fonte}_dir"] += frac * r["direita"]
                p[f"{fonte}_val"] += frac * r["validos"]; p[f"{fonte}_c"] += frac * r["comparecimento"]
                p[f"{fonte}_apt"] += frac * r["aptos"]
    lista = []
    for p in paises.values():
        vv = p["lula"] + p["flavio"]
        lista.append({
            "pais": p["pais"], "iso3": p["iso3"], "secoes": int(p["secoes"]), "secoes_tot": int(p["secoes_tot"]),
            "lula": int(p["lula"]), "flavio": int(p["flavio"]), "lula_pct": _pct(p["lula"], vv),
            "abstencao_pct": _pct(p["est"] - p["c"], p["est"]), "comparecimento": int(p["c"]),
            "lula_1t_pct": _pct(p["2026_1t_lula"], p["2026_1t_val"]),
            "flavio_1t_pct": _pct(p["2026_1t_dir"], p["2026_1t_val"]),
            "lula_2022_pct": _pct(p["2022_2t_lula"], p["2022_2t_lula"] + p["2022_2t_dir"]),
            "abstencao_1t_pct": _pct(p["2026_1t_apt"] - p["2026_1t_c"], p["2026_1t_apt"]),
            "abstencao_2022_pct": _pct(p["2022_2t_apt"] - p["2022_2t_c"], p["2022_2t_apt"]),
        })
    lista.sort(key=lambda x: -(x["lula"] + x["flavio"]))
    # linha do tempo: acumulado por ordem de download
    tl, acc = [], defaultdict(int)
    # ordem de chegada no TSE ("dd/mm/aaaa hh:mm:ss" → ISO); cai para a hora do download
    def _quando(r):
        t = r["recebido_tse"] or ""
        return f"{t[6:10]}-{t[3:5]}-{t[0:2]}T{t[11:19]}" if len(t) >= 19 else r["baixado_em"]

    bus = sorted(db.query("SELECT baixado_em, recebido_tse, aptos, comparecimento, lula, flavio FROM bu"), key=_quando)
    for r in bus:
        r["baixado_em"] = _quando(r)
        for k in ("aptos", "comparecimento", "lula", "flavio"):
            acc[k] += r[k]
        acc["n"] += 1
        tl.append({"t": r["baixado_em"], "secoes": acc["n"], "lula": acc["lula"], "flavio": acc["flavio"],
                   "lula_pct": _pct(acc["lula"], acc["lula"] + acc["flavio"]),
                   "abstencao_pct": _pct(acc["aptos"] - acc["comparecimento"], acc["aptos"])})
    total_sec = sum(sec_cidade.values())
    return {"paises": lista, "linha_tempo": tl[-400:], "secoes_tot": total_sec,
            "secoes": sum(e["secoes"] for e in ext_bu.values())}


def estado(db: DB) -> dict:
    bases = _bases(db)
    ext_bu = _exterior_bu(db)
    br, zz = _snap(db, "br"), _snap(db, "zz")
    out: dict = {
        "agora": datetime.now().isoformat(timespec="seconds"),
        "bases_ok": {f: len(v) for f, v in bases.items()},
        "nacional": br, "exterior_oficial": zz,
        "serie_br": _serie(db, "br"),
        "eventos": db.query("SELECT * FROM evento ORDER BY rowid DESC LIMIT 12"),
        "coleta": {
            "bu_secoes": db.one("SELECT count(*) n FROM bu")["n"],
            "secoes_ext": db.one("SELECT count(*) n FROM secao_ext")["n"],
            "municipios_lidos": db.one("SELECT count(*) n FROM mun WHERE secoes_apur > 0")["n"],
            "ultimo_snap": db.one("SELECT max(ts_coleta) t FROM snap")["t"],
        },
    }
    if "2026_1t" not in bases:
        return out
    out["exterior"] = exterior(db, bases, ext_bu)
    projs = {}
    for nome, fonte in (("vs_2022_2t", "2022_2t"), ("vs_2026_1t", "2026_1t")):
        if fonte not in bases:
            continue
        u, chaves = unidades_atuais(db, bases, fonte, ext_bu)
        projs[nome] = projetar(u, n_boot=300, seed=7)
        if "alpha_regiao" in projs[nome]:
            projs[nome]["alpha_regiao"] = dict(zip(REGIOES, projs[nome]["alpha_regiao"]))
        if nome == "vs_2026_1t":
            out["mesmas_urnas"] = comparacao_mesmas_urnas(u, chaves, bases)
            ext = np.array([k[0] == "zz" for k in chaves], dtype=float)
            out["mesmas_urnas_exterior"] = comparacao_mesmas_urnas(u, chaves, bases, mask=ext)
            # exterior isolado: projeção só com as cidades do exterior
            sel = ext.astype(bool)
            if (u.vv[sel] > 0).any():
                ue = Unidades(grupo=np.zeros(sel.sum(), dtype=int), regiao=np.zeros(sel.sum(), dtype=int),
                              te=u.te[sel], est=u.est[sel], c=u.c[sel], vv=u.vv[sel], lula=u.lula[sel],
                              base_l=u.base_l[sel], base_o=u.base_o[sel], base_comp=u.base_comp[sel],
                              base_valid=u.base_valid[sel], nomes_grupo=["zz"])
                pe = projetar(ue, n_boot=200, seed=3)
                pe["disponivel"] = True
                if "alpha_regiao" in pe:
                    pe["alpha_regiao"] = {"Exterior": pe["alpha_regiao"][0]}
                out["projecao_exterior"] = pe
            out["por_uf"] = por_uf(u, chaves, bases, db)
    out["projecoes"] = projs
    return out


def por_uf(u: Unidades, chaves: list, bases: dict, db: DB) -> list[dict]:
    snaps = {r["abr"]: r for r in db.query(
        "SELECT s.* FROM snap s JOIN (SELECT abr, max(ts_coleta) t FROM snap GROUP BY abr) x "
        "ON s.abr=x.abr AND s.ts_coleta=x.t")}
    out = []
    for gi, uf in enumerate(UFS_TODAS):
        sel = u.grupo == gi
        mask = sel.astype(float)
        cmp_ = comparacao_mesmas_urnas(u, chaves, bases, mask=mask)
        s = snaps.get(uf) or {}
        out.append({
            "uf": uf.upper(), "regiao": tse.REGIAO[uf],
            "apurado_pct": _pct(s.get("secoes_apur", 0), s.get("secoes_tot", 0)) if s else None,
            "lula_pct_oficial": _pct(s.get("lula", 0), s.get("validos", 0)) if s else None,
            "lula_pct": cmp_["lula_pct"], "abstencao_pct": cmp_["abstencao_pct"],
            "lula_1t_pct": cmp_["2026_1t"]["lula_pct"], "lula_2022_pct": cmp_["2022_2t"]["lula_2v_pct"],
            "abstencao_1t_pct": cmp_["2026_1t"]["abstencao_pct"], "abstencao_2022_pct": cmp_["2022_2t"]["abstencao_pct"],
            "eleitorado_apur_pct": _pct(float(u.est[sel].sum()), float(u.te[sel].sum())),
        })
    return out
