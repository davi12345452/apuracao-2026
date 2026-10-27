"""Monta o estado do painel a partir do SQLite: placar, projeções explicadas, exterior e mercados."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta

import numpy as np

from . import comparacao, movimentos, tse
from .db import DB
from .projecao import MIN_APURADO, Unidades, projetar

REGIOES = sorted(set(tse.REGIAO.values()))
UFS_TODAS = tse.UFS + ["zz"]
FONTES = ("2026_1t", "2022_1t", "2022_2t")
MODELOS = {"vs_2026_1t": "2026_1t", "vs_2022_2t": "2022_2t"}
NOMES_UF = {
    "ac": "Acre", "al": "Alagoas", "am": "Amazonas", "ap": "Amapá", "ba": "Bahia", "ce": "Ceará",
    "df": "Distrito Federal", "es": "Espírito Santo", "go": "Goiás", "ma": "Maranhão", "mg": "Minas Gerais",
    "ms": "Mato Grosso do Sul", "mt": "Mato Grosso", "pa": "Pará", "pb": "Paraíba", "pe": "Pernambuco",
    "pi": "Piauí", "pr": "Paraná", "rj": "Rio de Janeiro", "rn": "Rio Grande do Norte", "ro": "Rondônia",
    "rr": "Roraima", "rs": "Rio Grande do Sul", "sc": "Santa Catarina", "se": "Sergipe", "sp": "São Paulo",
    "to": "Tocantins", "zz": "Exterior",
}


def _pct(a, b):
    return round(float(100 * a / b), 3) if b else None


def _bu_por_cidade(rows) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows:
        e = out.setdefault(r["mun"], defaultdict(float))
        e["secoes"] += 1
        e["est"] += r["aptos"]; e["c"] += r["comparecimento"]
        e["lula"] += r["lula"]; e["flavio"] += r["flavio"]
        e["brancos"] += r["brancos"]; e["nulos"] += r["nulos"]
    return out


def _quando(r) -> str:
    """Hora em que o TSE recebeu o BU ("dd/mm/aaaa hh:mm:ss" → ISO); cai para a hora do download."""
    t = r.get("recebido_tse") or ""
    return f"{t[6:10]}-{t[3:5]}-{t[0:2]}T{t[11:19]}" if len(t) >= 19 else r["baixado_em"]


class Ctx:
    """Tudo o que uma montagem de estado precisa, lido uma vez do banco e alinhado por município."""

    def __init__(self, db: DB) -> None:
        self.db = db
        bases: dict[str, dict] = defaultdict(dict)
        for r in db.query("SELECT * FROM base"):
            bases[r["fonte"]][(r["uf"], r["mun"])] = r
        self.bases = bases
        self.chaves = sorted(bases.get("2026_1t", {}))
        self.idx = {k: i for i, k in enumerate(self.chaves)}
        n = len(self.chaves)
        self.uf = np.array([k[0] for k in self.chaves])
        self.grupo = np.array([UFS_TODAS.index(k[0]) for k in self.chaves], dtype=int)
        self.regiao = np.array([REGIOES.index(tse.REGIAO[k[0]]) for k in self.chaves], dtype=int)
        self.ext = self.uf == "zz"
        self.B = {}
        for f in FONTES:
            arr = {c: np.zeros(n) for c in ("lula", "direita", "outros", "validos", "comparecimento", "aptos")}
            tem = np.zeros(n, dtype=bool)
            for k, r in bases.get(f, {}).items():
                i = self.idx.get(k)
                if i is None:
                    continue
                tem[i] = True
                for c in arr:
                    arr[c][i] = r[c] or 0
            arr["tem"] = tem
            self.B[f] = arr
        muni = {(r["uf"], r["mun"]): r for r in db.query("SELECT * FROM municipio")}
        self.ibge = [(muni.get(k) or {}).get("ibge") or "" for k in self.chaves]
        self.nome = [(muni.get(k) or {}).get("nome") or "" for k in self.chaves]
        self.pais = np.array([(muni.get(k) or {}).get("pais") or "" for k in self.chaves])
        self.iso3 = {(muni.get(k) or {}).get("pais"): (muni.get(k) or {}).get("iso3") for k in self.chaves if k[0] == "zz"}
        self.bu_rows = sorted(db.query("SELECT * FROM bu"), key=_quando)
        self.ext_bu = _bu_por_cidade(self.bu_rows)
        self.mun = {(r["uf"], r["mun"]): r for r in db.query("SELECT * FROM mun")}
        self.ab = {(r["uf"], r["mun"]): r for r in db.query("SELECT * FROM mun_ab")}
        self.secoes_cidade = {r["mun"]: r["n"] for r in db.query("SELECT mun, count(*) n FROM secao_ext GROUP BY mun")}

    def unidades(self, fonte: str, ext_bu: dict | None = None, so_exterior: bool = False) -> Unidades:
        ext_bu = self.ext_bu if ext_bu is None else ext_bu
        n = len(self.chaves)
        a = {k: np.zeros(n) for k in ("te", "est", "c", "vv", "lula")}
        b1 = self.B["2026_1t"]
        for i, k in enumerate(self.chaves):
            ab = self.ab.get(k)
            a["te"][i] = (ab or {}).get("eleitorado") or b1["aptos"][i]
            m = self.mun.get(k)
            e = ext_bu.get(k[1]) if k[0] == "zz" else None
            # exterior: BU e totalização oficial convivem depois das 17h; vale a que cobre mais eleitorado
            if m and m["secoes_apur"] and (not e or m["eleitorado_apur"] >= e["est"]):
                a["est"][i], a["c"][i], a["vv"][i], a["lula"][i] = (
                    m["eleitorado_apur"], m["comparecimento"], m["validos"], m["lula"])
            elif e:
                a["est"][i], a["c"][i], a["vv"][i], a["lula"][i] = e["est"], e["c"], e["lula"] + e["flavio"], e["lula"]
        a["est"] = np.minimum(a["est"], a["te"])
        B = self.B[fonte]
        tem = B["tem"] & (B["validos"] > 0) & (B["comparecimento"] > 0) & (B["aptos"] > 0)
        sv = np.where(tem, B["validos"], 1)
        if fonte == "2022_2t":
            base_l = np.where(tem, B["lula"] / np.maximum(B["lula"] + B["direita"], 1), 0)
            base_o = np.zeros(n)
        else:
            base_l = np.where(tem, B["lula"] / sv, 0)
            base_o = np.where(tem, B["outros"] / sv, 0)
        base_comp = np.where(tem, B["comparecimento"] / np.where(tem, B["aptos"], 1), 0)
        base_valid = np.where(tem, B["validos"] / np.where(tem, B["comparecimento"], 1), 0)
        for g in np.unique(self.grupo[~tem]):  # sem base: média da UF ponderada pelo eleitorado
            sel, alvo = (self.grupo == g) & tem, (self.grupo == g) & ~tem
            w = a["te"][sel]
            for arr in (base_l, base_o, base_comp, base_valid):
                arr[alvo] = float((arr[sel] * w).sum() / w.sum()) if sel.any() and w.sum() else 0.5
        u = Unidades(grupo=self.grupo, regiao=self.regiao, te=a["te"], est=a["est"], c=a["c"], vv=a["vv"],
                     lula=a["lula"], base_l=base_l, base_o=base_o, base_comp=base_comp, base_valid=base_valid,
                     nomes_grupo=UFS_TODAS)
        if so_exterior:
            s = self.ext
            u = Unidades(grupo=np.zeros(s.sum(), dtype=int), regiao=np.zeros(s.sum(), dtype=int), te=u.te[s],
                         est=u.est[s], c=u.c[s], vv=u.vv[s], lula=u.lula[s], base_l=u.base_l[s], base_o=u.base_o[s],
                         base_comp=u.base_comp[s], base_valid=u.base_valid[s], nomes_grupo=["zz"])
        return u

    def comparar(self, u: Unidades, mask: np.ndarray | None = None) -> dict:
        """Mesmas urnas: os municípios apurados, na mesma proporção, em cada eleição anterior."""
        m = np.ones(len(u.te)) if mask is None else mask.astype(float)
        f = np.where(u.te > 0, u.est / np.where(u.te > 0, u.te, 1), 0) * m
        out = {"lula": float((u.lula * m).sum()), "validos": float((u.vv * m).sum()),
               "comparecimento": float((u.c * m).sum()), "eleitorado": float((u.est * m).sum())}
        out["flavio"] = out["validos"] - out["lula"]
        out["lula_pct"] = _pct(out["lula"], out["validos"])
        out["abstencao_pct"] = _pct(out["eleitorado"] - out["comparecimento"], out["eleitorado"])
        idx = np.where(self.ext)[0] if len(u.te) != len(self.chaves) else slice(None)
        for fonte in FONTES:
            B = {k: v[idx] for k, v in self.B[fonte].items()}
            L, D, O = (f * B["lula"]).sum(), (f * B["direita"]).sum(), (f * B["outros"]).sum()
            V, C, A = (f * B["validos"]).sum(), (f * B["comparecimento"]).sum(), (f * B["aptos"]).sum()
            out[fonte] = {"lula": round(L), "direita": round(D), "outros": round(O), "validos": round(V),
                          "lula_pct": _pct(L, V), "direita_pct": _pct(D, V), "lula_2v_pct": _pct(L, L + D),
                          "abstencao_pct": _pct(A - C, A), "comparecimento": round(C)}
        return out


def _agrupar(u: Unidades, p: dict, rotulos: np.ndarray, nomes: dict | None = None) -> list[dict]:
    """Decompõe a projeção por grupo (UF ou país): o que já foi contado e o que se espera do resto."""
    un = p["_unid"]
    out = []
    for g in [x for x in dict.fromkeys(rotulos.tolist()) if x]:
        s = rotulos == g
        vr, sr = un["vv_rest"][s], un["share_rest"][s]
        val_esp = float(vr.sum())
        lula_esp = float((vr * sr).sum())
        base_rest = float((vr * un["base"][s]).sum() / val_esp) if val_esp else None
        lula_c, vv_c = float(u.lula[s].sum()), float(u.vv[s].sum())
        out.append({
            "grupo": g, "nome": (nomes or {}).get(g, g),
            "apurado_pct": _pct(float(u.est[s].sum()), float(u.te[s].sum())),
            "eleitorado": float(u.te[s].sum()), "falta_eleitores": float(un["resto"][s].sum()),
            "contado_lula": lula_c, "contado_validos": vv_c, "lula_contado_pct": _pct(lula_c, vv_c),
            "validos_esperados": val_esp, "lula_esperado_pct": _pct(lula_esp, val_esp),
            "base_pct": round(100 * base_rest, 3) if base_rest is not None else None,
            "desvio_pp": round(100 * (lula_esp / val_esp - base_rest), 3) if val_esp else None,
            "saldo_esperado": 2 * lula_esp - val_esp,
            "lula_final_pct": _pct(lula_c + lula_esp, vv_c + val_esp),
        })
    out.sort(key=lambda x: -abs(x["saldo_esperado"]))
    return out


def _mapa_br(ctx: Ctx, u: Unidades, p: dict) -> list[list]:
    """Uma linha por município para o mapa: [ibge, nome, uf, eleitorado, apurado %, Lula contado %,
    Lula projetado %, desvio pp, Lula no 1º turno (2 candidatos) %]."""
    un = p.get("_unid")
    b1 = ctx.B["2026_1t"]
    t1 = np.where(b1["lula"] + b1["direita"] > 0, 100 * b1["lula"] / np.maximum(b1["lula"] + b1["direita"], 1), np.nan)
    r = lambda x, d=1: None if x is None or not np.isfinite(x) else round(float(x), d)  # noqa: E731
    out = []
    for i in np.where(~ctx.ext)[0]:
        if not ctx.ibge[i]:
            continue
        rep = u.vv[i] > 0
        contado = 100 * u.lula[i] / u.vv[i] if rep else None
        fin = desv = None
        if un is not None:
            vr, sr = un["vv_rest"][i], un["share_rest"][i]
            tot = u.vv[i] + vr
            fin = 100 * (u.lula[i] + vr * sr) / tot if tot > 0 else None
            desv = 100 * un["desvio"][i] if rep else None
        out.append([ctx.ibge[i], ctx.nome[i].title(), str(ctx.uf[i]), int(u.te[i]),
                    r(100 * u.est[i] / u.te[i] if u.te[i] else 0), r(contado), r(fin), r(desv, 2), r(t1[i])])
    return out


def _limpar(p: dict) -> dict:
    return {k: v for k, v in p.items() if not k.startswith("_")}


def _placar_snap(db: DB, abr: str) -> dict | None:
    r = db.one("SELECT * FROM snap WHERE abr=? ORDER BY ts_coleta DESC LIMIT 1", (abr,))
    if not r:
        return None
    r["apurado_pct"] = _pct(r["secoes_apur"], r["secoes_tot"])
    r["lula_pct"] = _pct(r["lula"], r["validos"])
    r["abstencao_pct"] = _pct(r["abstencao"], r["comparecimento"] + r["abstencao"])
    r["brancos_pct"] = _pct(r["brancos"], r["comparecimento"])
    r["nulos_pct"] = _pct(r["nulos"], r["comparecimento"])
    return r


_CACHE_HIST_EXT: dict = {"n": -1, "pontos": []}


def historico_exterior(ctx: Ctx) -> list[dict]:
    """Projeção do exterior refeita a cada lote de BUs, na ordem em que o TSE os recebeu."""
    n = len(ctx.bu_rows)
    if n == _CACHE_HIST_EXT["n"]:
        return _CACHE_HIST_EXT["pontos"]
    passo = max(10, n // 50)
    cortes = (list(range(passo, n, passo)) + [n]) if n else []
    pontos = []
    for c in cortes:
        u = ctx.unidades("2026_1t", ext_bu=_bu_por_cidade(ctx.bu_rows[:c]), so_exterior=True)
        p = projetar(u, n_boot=80, seed=11)
        if "lula_pct" not in p:
            continue
        pontos.append({"t": _quando(ctx.bu_rows[c - 1]), "secoes": c,
                       "parcial": 100 * p["contado"]["lula"] / max(p["contado"]["validos"], 1),
                       "p50": p["lula_pct"], "p10": p["p10"], "p90": p["p90"],
                       "apurado": 100 * p["apurado_eleitorado"]})
    _CACHE_HIST_EXT.update(n=n, pontos=pontos)
    return pontos


def mercados(db: DB) -> dict:
    out: dict = {"hist": {}}
    for fonte in ("polymarket", "kalshi"):
        rows = db.query("SELECT ts, dados FROM mercado WHERE fonte=? ORDER BY ts", (fonte,))
        if rows:
            out[fonte] = {"ts": rows[-1]["ts"], **json.loads(rows[-1]["dados"])}
        passo = max(1, len(rows) // 200)
        out["hist"][fonte] = [{"t": r["ts"], "p_lula": json.loads(r["dados"]).get("p_lula")} for r in rows[::passo]]
    return out


def _paises(ctx: Ctx, u: Unidades) -> list[dict]:
    pais = ctx.pais[ctx.ext]
    mun = [k[1] for k in ctx.chaves if k[0] == "zz"]
    b1, b22 = ({k: v[ctx.ext] for k, v in ctx.B[f].items()} for f in ("2026_1t", "2022_2t"))
    f = np.where(u.te > 0, u.est / np.where(u.te > 0, u.te, 1), 0)
    out = []
    for p in dict.fromkeys(pais.tolist()):
        s = pais == p
        sec = sum(ctx.secoes_cidade.get(m, 0) for m, ok in zip(mun, s) if ok)
        sec_bu = sum(ctx.ext_bu.get(m, {}).get("secoes", 0) for m, ok in zip(mun, s) if ok)
        L, V = float(u.lula[s].sum()), float(u.vv[s].sum())
        fl = f[s]
        out.append({
            "pais": p or "?", "iso3": ctx.iso3.get(p) or "", "secoes": int(sec_bu), "secoes_tot": int(sec),
            "eleitorado": float(u.te[s].sum()), "apurado_pct": _pct(float(u.est[s].sum()), float(u.te[s].sum())),
            "lula": L, "flavio": V - L, "lula_pct": _pct(L, V),
            "abstencao_pct": _pct(float(u.est[s].sum() - u.c[s].sum()), float(u.est[s].sum())),
            "lula_1t_2v_pct": _pct((fl * b1["lula"][s]).sum(), (fl * (b1["lula"][s] + b1["direita"][s])).sum()),
            "lula_2022_pct": _pct((fl * b22["lula"][s]).sum(), (fl * (b22["lula"][s] + b22["direita"][s])).sum()),
            "abstencao_1t_pct": _pct((fl * (b1["aptos"][s] - b1["comparecimento"][s])).sum(), (fl * b1["aptos"][s]).sum()),
            "lula_1t_final_2v_pct": _pct(b1["lula"][s].sum(), (b1["lula"][s] + b1["direita"][s]).sum()),
        })
    out.sort(key=lambda x: -x["eleitorado"])
    return out


def _bu_1t(db: DB) -> dict[tuple, dict]:
    """BUs do 1º turno das mesmas seções do exterior (scripts/baixar_bu_1t.py); vazio se a tabela não existe."""
    try:
        return {(r["mun"], r["zona"], r["secao"]): r for r in db.query("SELECT * FROM bu_1t")}
    except Exception:  # noqa: BLE001 - tabela opcional
        return {}


def _r(x, d=1):
    return None if x is None or not np.isfinite(x) else round(float(x), d)


def _secao_2022(db: DB) -> dict[tuple, dict]:
    """2º turno 2022 por seção do exterior (scripts/baixar_secao_2022.py); vazio se a tabela não existe."""
    try:
        return {(r["mun"], r["zona"], r["secao"]): r for r in db.query("SELECT * FROM secao_2022")}
    except Exception:  # noqa: BLE001 - tabela opcional
        return {}


def _refs_bu(ctx: Ctx, r: dict, bu1: dict, s22: dict | None = None) -> dict:
    """Referências de um BU do 2º turno: 1º turno 2026 e 2º turno 2022, cada um na mesma seção quando ela
    existe na outra eleição (chave município+zona+seção) e, só senão, na média da cidade."""
    i = ctx.idx.get(("zz", r["mun"]))
    out: dict = {"cidade": "", "pais": "", "lula_1t": None, "abst_1t": None, "ref_1t": None,
                 "lula_2022": None, "abst_2022": None, "ref_2022": None,
                 # votos de cada um na referência: a própria seção ou, se ela não existia, a média da cidade com o
                 # mesmo número de votantes desta seção (seção nova costuma ter abstenção bem diferente da cidade;
                 # escalar por aptos jogaria essa diferença no saldo dos candidatos)
                 "v_1t": None, "v_2022": None}
    esc = lambda b, i: r["comparecimento"] / b["comparecimento"][i] if b["comparecimento"][i] > 0 else 0.0  # noqa: E731
    s = (s22 or {}).get((r["mun"], r["zona"], r["secao"]))
    if s and (s["lula"] + s["bolsonaro"]) > 0 and s["aptos"]:
        out["lula_2022"] = 100 * s["lula"] / (s["lula"] + s["bolsonaro"])
        out["abst_2022"] = 100 * (s["aptos"] - s["comparecimento"]) / s["aptos"]
        out["ref_2022"] = "secao"
        out["v_2022"] = {"lula": s["lula"], "flavio": s["bolsonaro"], "outros": 0}
    if i is not None:
        out["cidade"], out["pais"] = ctx.nome[i].title(), str(ctx.pais[i]) or "?"
    s = bu1.get((r["mun"], r["zona"], r["secao"]))
    if s and (s["lula"] + s["flavio"]) > 0 and s["aptos"]:
        out["lula_1t"] = 100 * s["lula"] / (s["lula"] + s["flavio"])
        out["abst_1t"] = 100 * (s["aptos"] - s["comparecimento"]) / s["aptos"]
        out["ref_1t"] = "secao"
        out["v_1t"] = {"lula": s["lula"], "flavio": s["flavio"],
                       "outros": s["comparecimento"] - s["lula"] - s["flavio"] - s["brancos"] - s["nulos"]}
    elif i is not None:
        b = ctx.B["2026_1t"]
        if b["tem"][i] and b["lula"][i] + b["direita"][i] > 0 and b["aptos"][i] > 0:
            out["lula_1t"] = 100 * b["lula"][i] / (b["lula"][i] + b["direita"][i])
            out["abst_1t"] = 100 * (b["aptos"][i] - b["comparecimento"][i]) / b["aptos"][i]
            out["ref_1t"] = "cidade"
            k = esc(b, i)
            out["v_1t"] = {"lula": round(k * b["lula"][i]), "flavio": round(k * b["direita"][i]),
                           "outros": round(k * b["outros"][i])}
    if i is not None and out["ref_2022"] is None:
        b = ctx.B["2022_2t"]
        if b["tem"][i] and b["lula"][i] + b["direita"][i] > 0 and b["aptos"][i] > 0:
            out["lula_2022"] = 100 * b["lula"][i] / (b["lula"][i] + b["direita"][i])
            out["abst_2022"] = 100 * (b["aptos"][i] - b["comparecimento"][i]) / b["aptos"][i]
            out["ref_2022"] = "cidade"
            k = esc(b, i)
            out["v_2022"] = {"lula": round(k * b["lula"][i]), "flavio": round(k * b["direita"][i]), "outros": 0}
    return out


def placar_exterior(ctx: Ctx, agora: datetime | None = None) -> dict:
    """Números brutos do exterior: apurado, votos, crescimento nas MESMAS seções contra o 1º turno 2026 e
    o 2º turno 2022 (só seções que casam por município+zona+seção) e o que entrou na última hora."""
    bu1, s22 = _bu_1t(ctx.db), _secao_2022(ctx.db)
    rows = ctx.bu_rows
    soma = lambda rs, c: int(sum(r[c] for r in rs))  # noqa: E731
    b1 = ctx.B["2026_1t"]
    eleitorado = 0
    for i in np.where(ctx.ext)[0]:
        eleitorado += int((ctx.ab.get(ctx.chaves[i]) or {}).get("eleitorado") or b1["aptos"][i])
    out = {
        "secoes": len(rows), "secoes_tot": int(sum(ctx.secoes_cidade.values())),
        "eleitores": soma(rows, "aptos"), "eleitorado": eleitorado,
        "comparecimento": soma(rows, "comparecimento"),
        "lula": soma(rows, "lula"), "flavio": soma(rows, "flavio"),
        "brancos": soma(rows, "brancos"), "nulos": soma(rows, "nulos"),
    }
    out["validos"] = out["lula"] + out["flavio"]
    out["saldo"] = out["lula"] - out["flavio"]
    # mesmas seções: agora × antes, só as que casam
    k = lambda r: (r["mun"], r["zona"], r["secao"])  # noqa: E731
    m1 = [(r, bu1[k(r)]) for r in rows if k(r) in bu1]
    m22 = [(r, s22[k(r)]) for r in rows if k(r) in s22]
    sm = lambda ps, j, c: int(sum(p[j][c] for p in ps))  # noqa: E731
    out["vs_1t"] = {"secoes": len(m1),
                    "lula": sm(m1, 0, "lula"), "lula_antes": sm(m1, 1, "lula"),
                    "flavio": sm(m1, 0, "flavio"), "flavio_antes": sm(m1, 1, "flavio"),
                    "comparecimento": sm(m1, 0, "comparecimento"), "comparecimento_antes": sm(m1, 1, "comparecimento"),
                    "aptos": sm(m1, 0, "aptos"), "aptos_antes": sm(m1, 1, "aptos"),
                    # de onde vieram os votos novos: 3ª via do 1º turno, brancos/nulos e comparecimento
                    "brancos_nulos": sm(m1, 0, "brancos") + sm(m1, 0, "nulos"),
                    "brancos_nulos_antes": sm(m1, 1, "brancos") + sm(m1, 1, "nulos")}
    v1 = out["vs_1t"]
    v1["outros_antes"] = (v1["comparecimento_antes"] - v1["lula_antes"] - v1["flavio_antes"]
                          - v1["brancos_nulos_antes"])
    out["vs_2022"] = {"secoes": len(m22),
                      "lula": sm(m22, 0, "lula"), "lula_antes": sm(m22, 1, "lula"),
                      "flavio": sm(m22, 0, "flavio"), "flavio_antes": sm(m22, 1, "bolsonaro"),
                      "comparecimento": sm(m22, 0, "comparecimento"), "comparecimento_antes": sm(m22, 1, "comparecimento"),
                      "aptos": sm(m22, 0, "aptos"), "aptos_antes": sm(m22, 1, "aptos")}
    # última hora, pela hora em que o TSE recebeu
    corte = ((agora or datetime.now()) - timedelta(hours=1)).isoformat(timespec="seconds")
    uh = [r for r in rows if _quando(r) >= corte]
    out["ultima_hora"] = {"secoes": len(uh), "lula": soma(uh, "lula"), "flavio": soma(uh, "flavio"),
                          "comparecimento": soma(uh, "comparecimento")}
    return out


GRUPOS_1T = [(0, 40, "Flávio forte", "f"), (40, 50, "Flávio leve", "f"), (50, 60, "Lula leve", "l"), (60, 101, "Lula forte", "l")]


def _decompor(L2, F2, C2, A2, B2, L1, F1, C1, A1, B1, lugar: np.ndarray, iso: dict, n_boot: int = 300) -> dict:
    """Por que cada um cresceu desde o 1º turno, unidade a unidade (seção no exterior, município no Brasil).

    Decomposição ecológica (regressão de Goodman): votos ganhos por apto = a·(3ª via do 1º turno por apto)
    + b·(votos válidos novos por apto), mínimos quadrados ponderados pelos aptos. Votos válidos novos =
    Δcomparecimento − Δbrancos/nulos: quem passou a votar em alguém (antes se absteve ou votou branco/nulo),
    ou deixou de votar, se negativo. a é a fatia da 3ª via que foi para o candidato; b, a dos válidos novos.
    Em cada unidade vale a identidade ΔLula + ΔFlávio = 3ª via + válidos novos; como o ajuste é linear, os
    coeficientes de Lula e de Flávio somam exatamente 1 em cada canal. Usar só Δcomparecimento deixava a queda
    de brancos e nulos sem canal (ela ia para a 3ª via e as fatias passavam de 100% somadas); separá-la num
    terceiro canal dá coeficientes fora de [0, 1] por colinearidade.
    Estimativa pelo padrão entre unidades, não o voto de cada eleitor. Faixa: bootstrap das unidades (p10–p90).
    Também agrupa as unidades pela inclinação no 1º turno (a abstenção caiu em lugar pró ou anti Lula?)
    e por lugar (país ou UF)."""
    O1, dL, dF, dC, dB = C1 - L1 - F1 - B1, L2 - L1, F2 - F1, C2 - C1, B2 - B1
    dV = dC - dB  # votos válidos novos
    Z = np.c_[O1 / A1, dV / A1]
    w = np.sqrt(A1)

    def ajuste(idx):
        coef = {}
        for nome, d in (("lula", dL), ("flavio", dF)):
            c, *_ = np.linalg.lstsq(Z[idx] * w[idx, None], (d[idx] / A1[idx]) * w[idx], rcond=None)
            coef[nome] = c
        return coef

    n = len(L2)
    coef = ajuste(np.arange(n))
    rng = np.random.default_rng(7)
    boot = [ajuste(rng.integers(0, n, n)) for _ in range(n_boot)]
    O, D = O1.sum(), dV.sum()
    cand = {}
    for nome, d in (("lula", dL), ("flavio", dF)):
        a, b = coef[nome]
        ba = np.array([c[nome][0] for c in boot]); bb = np.array([c[nome][1] for c in boot])
        # "do_comparecimento" guarda os válidos novos (comparecimento + brancos/nulos que viraram voto)
        cand[nome] = {"ganho": int(round(d.sum())), "da_3via": int(round(a * O)), "do_comparecimento": int(round(b * D)),
                      "fatia_3via": _r(100 * a), "fatia_3via_faixa": [_r(100 * np.percentile(ba, 10)), _r(100 * np.percentile(ba, 90))],
                      "fatia_novos": _r(100 * b), "fatia_novos_faixa": [_r(100 * np.percentile(bb, 10)), _r(100 * np.percentile(bb, 90))]}
        cand[nome]["resto"] = cand[nome]["ganho"] - cand[nome]["da_3via"] - cand[nome]["do_comparecimento"]

    def resumo(m):
        return {"unidades": int(m.sum()), "aptos": int(round(A2[m].sum())),
                "abst_1t": _pct(A1[m].sum() - C1[m].sum(), A1[m].sum()), "abst": _pct(A2[m].sum() - C2[m].sum(), A2[m].sum()),
                "d_comparecimento": int(round(dC[m].sum())), "outros_1t": int(round(O1[m].sum())),
                "lula": int(round(dL[m].sum())), "flavio": int(round(dF[m].sum())),
                "lula_1t_pct": _pct(L1[m].sum(), L1[m].sum() + F1[m].sum()), "lula_pct": _pct(L2[m].sum(), L2[m].sum() + F2[m].sum())}

    incl = 100 * L1 / np.maximum(L1 + F1, 1e-9)
    grupos = []
    for lo, hi, nome, lado in GRUPOS_1T:
        m = (incl >= lo) & (incl < hi)
        if m.any():
            grupos.append({"nome": nome, "lado": lado, "de": lo, "ate": min(hi, 100), **resumo(m)})
    lugares = [{"lugar": str(x), "iso3": iso.get(str(x)) or "", **resumo(lugar == x)} for x in set(lugar.tolist())]
    lugares = sorted((x for x in lugares if x["unidades"] >= 3), key=lambda x: -abs(x["d_comparecimento"]))
    return {"unidades": n, "outros_1t": int(round(O)), "d_comparecimento": int(round(dC.sum())), "d_validos_novos": int(round(D)), "d_brancos_nulos": int(round((B2 - B1).sum())),
            "abst_1t": _pct(A1.sum() - C1.sum(), A1.sum()), "abst": _pct(A2.sum() - C2.sum(), A2.sum()),
            "candidatos": cand, "grupos": grupos, "lugares": lugares}


def crescimento_exterior(ctx: Ctx) -> dict | None:
    """_decompor nas seções do exterior que existem nos dois turnos (BU contra BU)."""
    bu1 = _bu_1t(ctx.db)
    k = lambda r: (r["mun"], r["zona"], r["secao"])  # noqa: E731
    pares = [(r, bu1[k(r)]) for r in ctx.bu_rows if k(r) in bu1 and bu1[k(r)]["aptos"] and r["aptos"]]
    if len(pares) < 20:
        return None
    X = np.array([[r["lula"], r["flavio"], r["comparecimento"], r["aptos"], r["brancos"] + r["nulos"],
                   s["lula"], s["flavio"], s["comparecimento"], s["aptos"], s["brancos"] + s["nulos"]]
                  for r, s in pares], float)
    lugar = np.array([str(ctx.pais[ctx.idx[("zz", r["mun"])]]) if ("zz", r["mun"]) in ctx.idx else "?" for r, _ in pares])
    return {"unidade": "seções", "tipo_lugar": "país", **_decompor(*X.T, lugar, ctx.iso3)}


MIN_FRAC_MUN = 0.9


def crescimento_brasil(ctx: Ctx, u: Unidades) -> dict | None:
    """_decompor nos municípios com 90% ou mais do eleitorado apurado: o 1º turno de cada um na escala da
    fração apurada (eleitores apurados / aptos do 1º turno), como na análise do Brasil. Município parcial fica
    de fora porque, nele, a diferença ainda mede a ordem em que as seções entram (centro antes da periferia)."""
    b1 = ctx.B["2026_1t"]
    m = (u.vv > 0) & b1["tem"] & (b1["aptos"] > 0) & ~ctx.ext & (u.est >= MIN_FRAC_MUN * u.te)
    if m.sum() < 30:
        return None
    g = u.est[m] / b1["aptos"][m]
    L2, VV, C2, A2 = u.lula[m], u.vv[m], u.c[m], u.est[m]
    B2 = np.maximum(C2 - VV, 0)
    L1, F1 = g * b1["lula"][m], g * b1["direita"][m]
    C1, A1 = g * b1["comparecimento"][m], g * b1["aptos"][m]
    B1 = g * np.maximum(b1["comparecimento"][m] - b1["validos"][m], 0)
    ufs = np.array([str(c[0]).upper() for c, ok in zip(ctx.chaves, m) if ok])
    return {"unidade": "municípios", "tipo_lugar": "estado", "min_frac": MIN_FRAC_MUN, "eleitorado_pct": _pct(u.est[m].sum(), u.te[~ctx.ext].sum()), **_decompor(L2, VV - L2, C2, A2, B2, L1, F1, C1, A1, B1, ufs, {})}

def resultado_final(ctx: Ctx, m: np.ndarray) -> dict:
    """Resultado completo (não só as seções já apuradas) do 2º turno 2022 e do 1º turno 2026 no escopo:
    Lula entre os dois primeiros e abstenção."""
    out = {}
    for b in ("2022_2t", "2026_1t"):
        B = ctx.B[b]
        L, D, C, A = B["lula"][m].sum(), B["direita"][m].sum(), B["comparecimento"][m].sum(), B["aptos"][m].sum()
        out[b] = {"lula_pct": _pct(L, L + D), "abstencao_pct": _pct(A - C, A)}
    return out


K_FAIXA = 20.0  # ridge das variáveis de uma faixa para as do exterior todo (em "seções equivalentes")


def variaveis_exterior(ctx: Ctx) -> dict | None:
    """Variáveis do exterior por faixa do 1º turno: fatia da 3ª via e de quem passou a votar que foi para
    cada um (regressão por seção, puxada para a do exterior todo quando a faixa tem poucas seções)."""
    bu1 = _bu_1t(ctx.db)
    k = lambda r: (r["mun"], r["zona"], r["secao"])  # noqa: E731
    pares = [(r, bu1[k(r)]) for r in ctx.bu_rows if k(r) in bu1 and bu1[k(r)]["aptos"] and r["aptos"]]
    if len(pares) < 40:
        return None
    X = np.array([[r["lula"], r["flavio"], r["comparecimento"], s["lula"], s["flavio"], s["comparecimento"], s["aptos"],
                   s["brancos"] + s["nulos"], r["brancos"] + r["nulos"]] for r, s in pares], float)
    L2, F2, C2, L1, F1, C1, A1, B1, B2 = X.T
    O1 = C1 - L1 - F1 - B1
    # mesmos canais de _decompor: 3ª via e válidos novos (comparecimento + brancos/nulos que viraram voto)
    Z = np.c_[O1 / A1, ((C2 - C1) - (B2 - B1)) / A1] * np.sqrt(A1)[:, None]
    Y = np.c_[(L2 - L1) / A1, (F2 - F1) / A1] * np.sqrt(A1)[:, None]
    glob = np.linalg.lstsq(Z, Y, rcond=None)[0]  # 2×2: linhas 3ª via / válidos novos, colunas Lula / Flávio
    incl = 100 * L1 / np.maximum(L1 + F1, 1)
    faixas = []
    for lo, hi, nome, lado in GRUPOS_1T:
        m = (incl >= lo) & (incl < hi)
        G = Z[m].T @ Z[m] + K_FAIXA * 1e-3 * np.eye(2)
        c = np.linalg.solve(G, Z[m].T @ Y[m] + K_FAIXA * 1e-3 * glob) if m.any() else glob
        faixas.append({"nome": nome, "lado": lado, "de": lo, "ate": min(hi, 100), "secoes": int(m.sum()),
                       "c": c, "terceira_lula": _r(100 * c[0, 0]), "terceira_flavio": _r(100 * c[0, 1]),
                       "novos_lula": _r(100 * c[1, 0]), "novos_flavio": _r(100 * c[1, 1])})
    return {"secoes": len(pares), "faixas": faixas}


def cenario_brasil(ctx: Ctx, var: dict, u: Unidades | None = None) -> dict:
    """O Brasil votando com as variáveis do exterior: cada município recebe as da sua faixa do 1º turno.
    Variação do comparecimento: a do próprio município do 1º para o 2º turno de 2022. Depois das 17h,
    cada região também traz o que ela mesma mede (municípios com 90% ou mais apurado)."""
    b1, a1, a2 = ctx.B["2026_1t"], ctx.B["2022_1t"], ctx.B["2022_2t"]
    m = ~ctx.ext & b1["tem"] & (b1["aptos"] > 0) & (b1["lula"] + b1["direita"] > 0)
    L1, F1, O1, C1, A1 = b1["lula"], b1["direita"], b1["outros"], b1["comparecimento"], b1["aptos"]
    ok22 = a1["tem"] & a2["tem"] & (a1["comparecimento"] > 0)
    r_nac = a2["comparecimento"][m & ok22].sum() / a1["comparecimento"][m & ok22].sum()
    r22 = np.where(ok22, a2["comparecimento"] / np.where(ok22, a1["comparecimento"], 1), r_nac)
    dC = np.where(m, C1 * (r22 - 1), 0.0)
    # brancos e nulos que viram voto: a fração do 1º turno que sumiu no 2º turno de 2022 no mesmo município
    bn1, bn21, bn22 = C1 - b1["validos"], a1["comparecimento"] - a1["validos"], a2["comparecimento"] - a2["validos"]
    okb = ok22 & (bn21 > 0)
    q_nac = 1 - bn22[m & okb].sum() / bn21[m & okb].sum()
    q22 = np.where(okb, 1 - bn22 / np.where(okb, bn21, 1), q_nac)
    dBN = np.where(m, np.maximum(bn1, 0) * np.clip(q22, -1, 1), 0.0)
    incl = 100 * L1 / np.maximum(L1 + F1, 1)
    dL3, dLn, dF3, dFn = (np.zeros(len(L1)) for _ in range(4))
    for f in var["faixas"]:
        g = m & (incl >= f["de"]) & ((incl < f["ate"]) if f["ate"] < 100 else True)
        c = f["c"]
        dL3[g], dF3[g] = c[0, 0] * O1[g], c[0, 1] * O1[g]
        # válidos novos: quem passou a votar e os brancos/nulos que viraram voto
        dLn[g], dFn[g] = c[1, 0] * (dC[g] + dBN[g]), c[1, 1] * (dC[g] + dBN[g])
    L2, F2 = np.maximum(L1 + dL3 + dLn, 0), np.maximum(F1 + dF3 + dFn, 0)
    medido = None
    if u is not None:
        b = (u.vv > 0) & m & (u.est >= MIN_FRAC_MUN * u.te)
        medido = b

    def agrega(sel):
        s1, s2 = (L1[sel] + F1[sel]).sum(), (L2[sel] + F2[sel]).sum()
        r = {"lula_1t_pct": _pct(L1[sel].sum(), s1), "lula_pct": _pct(L2[sel].sum(), s2),
             "lula_3via": int(round(dL3[sel].sum())), "lula_novos": int(round(dLn[sel].sum())),
             "flavio_3via": int(round(dF3[sel].sum())), "flavio_novos": int(round(dFn[sel].sum())),
             "outros_1t": int(round(O1[sel].sum())), "d_comparecimento": int(round(dC[sel].sum())),
             "abst_1t": _pct(A1[sel].sum() - C1[sel].sum(), A1[sel].sum()),
             "abst": _pct(A1[sel].sum() - C1[sel].sum() - dC[sel].sum(), A1[sel].sum()),
             "saldo_lula": int(round((L2[sel] - F2[sel]).sum())), "saldo_lula_1t": int(round((L1[sel] - F1[sel]).sum()))}
        if medido is not None:
            mm = sel & medido
            if mm.sum() >= 30:
                g = u.est[mm] / A1[mm]
                try:
                    d = _decompor(u.lula[mm], u.vv[mm] - u.lula[mm], u.c[mm], u.est[mm], np.maximum(u.c[mm] - u.vv[mm], 0),
                                  g * L1[mm], g * F1[mm], g * C1[mm], g * A1[mm],
                                  g * np.maximum(C1[mm] - b1["validos"][mm], 0), np.array(["x"] * int(mm.sum())), {}, n_boot=60)
                    r["medido"] = {"municipios": int(mm.sum()), "lula_pct": _pct(u.lula[mm].sum(), u.vv[mm].sum()),
                                   "lula_1t_pct": _pct((g * L1[mm]).sum(), (g * (L1[mm] + F1[mm])).sum()),
                                   "terceira_lula": d["candidatos"]["lula"]["fatia_3via"], "novos_lula": d["candidatos"]["lula"]["fatia_novos"],
                                   "abst_1t": d["abst_1t"], "abst": d["abst"]}
                except Exception:  # noqa: BLE001 - sem medição nesta região
                    pass
        return r

    regioes = []
    for nome in ORDEM_REGIOES:
        if nome == "Exterior":
            continue
        sel = m & (ctx.regiao == REGIOES.index(nome)) if nome in REGIOES else np.zeros(len(m), bool)
        ufs = sorted({str(ctx.uf[i]) for i in np.where(sel)[0]})
        regioes.append({"regiao": nome, **agrega(sel),
                        "ufs": [{"uf": uf.upper(), "nome": NOMES_UF.get(uf, uf), **agrega(sel & (ctx.uf == uf))} for uf in ufs]})
    mun = {ctx.ibge[i]: _r(100 * L2[i] / (L2[i] + F2[i])) for i in np.where(m)[0] if ctx.ibge[i] and L2[i] + F2[i] > 0}
    return {"secoes_exterior": var["secoes"],
            "faixas": [{k: v for k, v in f.items() if k != "c"} for f in var["faixas"]],
            "brasil": agrega(m), "regioes": regioes, "mun": mun}


def recentes_exterior(ctx: Ctx, n: int = 100, n_lotes: int = 12, janela_min: int = 10) -> tuple[list[dict], list[dict]]:
    """Os boletins mais recentes do exterior (mais novo primeiro) e as chegadas em janelas de 10 min,
    cada um comparado com o 1º turno (mesma seção quando há, senão média da cidade) e com 2022 (cidade)."""
    bu1, s22 = _bu_1t(ctx.db), _secao_2022(ctx.db)
    linhas = []
    for r in ctx.bu_rows:
        ref = _refs_bu(ctx, r, bu1, s22)
        v2 = r["lula"] + r["flavio"]
        lula = 100 * r["lula"] / v2 if v2 else None
        abst = 100 * (r["aptos"] - r["comparecimento"]) / r["aptos"] if r["aptos"] else None
        dif = lambda a, b: None if a is None or b is None else a - b  # noqa: E731
        linhas.append({
            "t": _quando(r), "mun": r["mun"], "zona": r["zona"], "secao": r["secao"],
            "cidade": ref["cidade"], "pais": ref["pais"], "iso3": ctx.iso3.get(ref["pais"]) or "",
            "aptos": r["aptos"], "comparecimento": r["comparecimento"], "lula": r["lula"], "flavio": r["flavio"],
            "brancos": r["brancos"], "nulos": r["nulos"], "lula_pct": lula, "abstencao_pct": abst,
            "ref_1t": ref["ref_1t"], "lula_1t_pct": ref["lula_1t"], "abstencao_1t_pct": ref["abst_1t"],
            "d_lula_1t": dif(lula, ref["lula_1t"]), "d_abst_1t": dif(abst, ref["abst_1t"]),
            "lula_2022_pct": ref["lula_2022"], "abstencao_2022_pct": ref["abst_2022"], "ref_2022": ref["ref_2022"],
            "d_lula_2022": dif(lula, ref["lula_2022"]), "d_abst_2022": dif(abst, ref["abst_2022"]),
            "v_1t": ref["v_1t"], "v_2022": ref["v_2022"],
        })
    # lotes: janelas de 10 min pela hora de recebimento no TSE
    grupos: dict[str, list[dict]] = {}
    for x in linhas:
        t = x["t"]
        m = int(t[14:16]) // janela_min * janela_min
        grupos.setdefault(f"{t[:14]}{m:02d}", []).append(x)
    lotes = []
    for ini in sorted(grupos, reverse=True)[:n_lotes]:
        g = grupos[ini]
        L, F = sum(x["lula"] for x in g), sum(x["flavio"] for x in g)
        A, C = sum(x["aptos"] for x in g), sum(x["comparecimento"] for x in g)
        w1 = [(x["lula"] + x["flavio"], x["lula_1t_pct"]) for x in g if x["lula_1t_pct"] is not None]
        w22 = [(x["lula"] + x["flavio"], x["lula_2022_pct"]) for x in g if x["lula_2022_pct"] is not None]
        a1 = [(x["aptos"], x["abstencao_1t_pct"]) for x in g if x["abstencao_1t_pct"] is not None]
        med = lambda ws: (sum(w * v for w, v in ws) / sum(w for w, _ in ws)) if ws and sum(w for w, _ in ws) else None  # noqa: E731
        cont: dict[str, int] = defaultdict(int)
        for x in g:
            cont[x["pais"]] += 1
        g1 = [x for x in g if x["ref_1t"] == "secao"]
        h0 = int(ini[11:13]) * 60 + int(ini[14:16]) + janela_min
        lotes.append({
            "de": ini, "ate": f"{ini[:11]}{h0 // 60 % 24:02d}:{h0 % 60:02d}", "boletins": len(g),
            "paises": [[p, k] for p, k in sorted(cont.items(), key=lambda kv: -kv[1])],
            "lula": L, "flavio": F, "lula_pct": _pct(L, L + F), "abstencao_pct": _pct(A - C, A),
            "lula_1t_pct": _r(med(w1), 3), "abstencao_1t_pct": _r(med(a1), 3), "lula_2022_pct": _r(med(w22), 3),
            "secao_1t": sum(1 for x in g if x["ref_1t"] == "secao"),
            # votos brutos contra o 1º turno, só nas seções que existem nos dois turnos
            "vs_1t": {"lula": sum(x["lula"] for x in g1), "lula_antes": sum(x["v_1t"]["lula"] for x in g1),
                      "flavio": sum(x["flavio"] for x in g1), "flavio_antes": sum(x["v_1t"]["flavio"] for x in g1),
                      "outros_antes": sum(x["v_1t"]["outros"] for x in g1)},
        })
    rec = []
    for x in reversed(linhas[-n:]):
        rec.append({k: (_r(v) if isinstance(v, float) else v) for k, v in x.items()})
    return rec, lotes


# ---------------- Brasil: o que acabou de entrar, origem dos votos, abstenção e 3ª via ----------------
ORDEM_REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul", "Exterior"]


def _br_div(a, b, k=100.0, d=2):
    a, b = float(a), float(b)
    return round(k * a / b, d) if b else None


def _br_dif(a, b):
    return round(a - b, 2) if a is not None and b is not None else None


# Só as linhas mais recentes (índice em ts_coleta; um lote tem no máximo ~5,6 mil municípios) e, para cada
# uma, a leitura anterior do mesmo município pela chave primária. Nada varre a mun_hist inteira.
_SQL_INCR = """
WITH rec AS (
  SELECT rowid rid, coalesce(dg, '') dgk, substr(coalesce(hg, ''), 1, 5) hm, ts_coleta FROM mun_hist
  ORDER BY ts_coleta DESC LIMIT ?
), lotes AS (
  SELECT dgk, hm, max(ts_coleta) t FROM rec GROUP BY dgk, hm ORDER BY t DESC LIMIT ?
)
SELECT h.uf, h.mun, h.dg, h.hg, h.ts_coleta, h.secoes_tot, h.secoes_apur, h.eleitorado_apur, h.comparecimento,
       h.validos, h.brancos, h.nulos, h.lula, h.flavio, lotes.t lote_t,
       coalesce(p.secoes_apur, 0) p_sec, coalesce(p.eleitorado_apur, 0) p_est, coalesce(p.comparecimento, 0) p_c,
       coalesce(p.brancos, 0) p_vb, coalesce(p.nulos, 0) p_vn, coalesce(p.lula, 0) p_l, coalesce(p.flavio, 0) p_f
FROM rec JOIN lotes ON rec.dgk = lotes.dgk AND rec.hm = lotes.hm
JOIN mun_hist h ON h.rowid = rec.rid
LEFT JOIN mun_hist p ON p.uf = h.uf AND p.mun = h.mun AND p.secoes_apur = (
  SELECT max(x.secoes_apur) FROM mun_hist x WHERE x.uf = h.uf AND x.mun = h.mun AND x.secoes_apur < h.secoes_apur)
"""
_LINHAS_RECENTES = 50_000
_CACHE_INCR: dict = {"chave": None, "rows": []}


def _linhas_incr(db: DB, n_lotes: int) -> list[dict]:
    """Linhas cruas dos incrementos, refeitas só quando a mun_hist muda (o painel recalcula a cada 8 s)."""
    sig = db.one("SELECT max(rowid) r, count(*) n FROM mun_hist") or {}
    chave = (sig.get("r"), sig.get("n"), n_lotes)
    if chave != _CACHE_INCR["chave"]:
        _CACHE_INCR.update(chave=chave, rows=db.query(_SQL_INCR, (_LINHAS_RECENTES, n_lotes)) if sig.get("n") else [])
    return _CACHE_INCR["rows"]


def _incrementos(ctx: Ctx, n_lotes: int, alpha: dict | None = None) -> list[dict]:
    """Urnas que acabaram de entrar: diferença entre leituras seguidas de cada município (mun_hist),
    nos últimos lotes do TSE (mesma data e hora-minuto do arquivo). Comparadas com o MESMO município
    inteiro no 1º turno e em 2022 (não existe dado por seção)."""
    try:
        rows = _linhas_incr(ctx.db, n_lotes)
    except Exception as e:  # noqa: BLE001 - banco antigo sem mun_hist
        ctx.db.log("aviso", f"incrementos: {e!r}")
        return []
    b1, b22 = ctx.B["2026_1t"], ctx.B["2022_2t"]
    out = []
    for r in rows:
        i = ctx.idx.get((r["uf"], r["mun"]))
        est, c = r["eleitorado_apur"] - r["p_est"], r["comparecimento"] - r["p_c"]
        lu, fl = r["lula"] - r["p_l"], r["flavio"] - r["p_f"]
        bn = r["brancos"] + r["nulos"] - r["p_vb"] - r["p_vn"]
        if est <= 0 or lu + fl <= 0:
            continue
        e = {"uf": r["uf"].upper(), "mun": r["mun"], "nome": (ctx.nome[i].title() if i is not None else r["mun"]),
             "regiao": tse.REGIAO.get(r["uf"], "?"), "hg": r["hg"] or "", "dg": r["dg"] or "", "lote": f"{r['dg'] or ''} {(r['hg'] or '')[:5]}",
             "_t": r["lote_t"], "secoes": r["secoes_apur"] - r["p_sec"], "secoes_apur": r["secoes_apur"],
             "secoes_tot": r["secoes_tot"], "completo": r["secoes_apur"] >= r["secoes_tot"], "primeira": r["p_sec"] == 0,
             "eleitores": est, "comparecimento": c, "lula": lu, "flavio": fl, "brancos_nulos": bn,
             "lula_pct": _br_div(lu, lu + fl), "abstencao_pct": _br_div(est - c, est), "bn_pct": _br_div(bn, c),
             "_s1": None, "_ab1": None, "_sesp": None}
        if i is not None and b1["tem"][i] and b1["aptos"][i] > 0:
            L1, D1, V1 = b1["lula"][i], b1["direita"][i], b1["validos"][i]
            e["t1"] = {"lula_pct": _br_div(L1, L1 + D1), "outros_pct": _br_div(b1["outros"][i], V1),
                       "abstencao_pct": _br_div(b1["aptos"][i] - b1["comparecimento"][i], b1["aptos"][i])}
            e["_s1"] = L1 / (L1 + D1) if L1 + D1 else None
            e["_ab1"] = 1 - b1["comparecimento"][i] / b1["aptos"][i]
            a = (alpha or {}).get(e["regiao"])
            if a is not None and V1 > 0:  # base da projeção: Lula no 1º turno + α × outros
                e["_sesp"] = min(1.0, (L1 + a / 100 * b1["outros"][i]) / V1)
            e["dif_1t"] = {"lula_pp": _br_dif(e["lula_pct"], e["t1"]["lula_pct"]),
                           "abstencao_pp": _br_dif(e["abstencao_pct"], e["t1"]["abstencao_pct"])}
        if i is not None and b22["tem"][i] and b22["aptos"][i] > 0:
            L, B = b22["lula"][i], b22["direita"][i]
            e["t22"] = {"lula_pct": _br_div(L, L + B),
                        "abstencao_pct": _br_div(b22["aptos"][i] - b22["comparecimento"][i], b22["aptos"][i])}
            e["dif_2022"] = {"lula_pp": _br_dif(e["lula_pct"], e["t22"]["lula_pct"]),
                             "abstencao_pp": _br_dif(e["abstencao_pct"], e["t22"]["abstencao_pct"])}
        out.append(e)
    return out


def _lotes(incr: list[dict]) -> list[dict]:
    """Lote = arquivos de município gerados pelo TSE no mesmo minuto (dg + hora:minuto do arquivo):
    quanto entrou por região e Lula × o esperado. Separa o que veio de primeiras leituras (município
    lido pela primeira vez: pode trazer várias atualizações do TSE de uma vez)."""
    por: dict[str, dict] = {}
    for e in incr:
        lt = por.setdefault(e["lote"], {"lote": e["lote"], "hg": (e["hg"] or "")[:5], "_t": e["_t"], "regs": defaultdict(lambda: defaultdict(float))})
        for chave in (e["regiao"], "Total"):
            a = lt["regs"][chave]
            if e["primeira"]:
                a["municipios_1a"] += 1; a["validos_1a"] += e["lula"] + e["flavio"]
            a["municipios"] += 1; a["secoes"] += e["secoes"]; a["eleitores"] += e["eleitores"]
            a["comparecimento"] += e["comparecimento"]; a["lula"] += e["lula"]; a["validos"] += e["lula"] + e["flavio"]
            if e["_s1"] is not None:
                v = e["lula"] + e["flavio"]
                a["v_base"] += v; a["l_base"] += v * e["_s1"]; a["l_base_obs"] += e["lula"]
                a["e_base"] += e["eleitores"]; a["ab_base"] += e["eleitores"] * e["_ab1"]
            if e["_sesp"] is not None:
                v = e["lula"] + e["flavio"]
                a["v_esp"] += v; a["l_esp"] += v * e["_sesp"]; a["l_esp_obs"] += e["lula"]
    out = []
    for lt in sorted(por.values(), key=lambda x: x["_t"], reverse=True):
        regs = []
        for nome, a in lt["regs"].items():
            lula_pct = _br_div(a["lula"], a["validos"])
            esp = _br_div(a["l_base"], a["v_base"])
            regs.append({"regiao": nome, "municipios": int(a["municipios"]), "secoes": int(a["secoes"]),
                         "municipios_1a_leitura": int(a["municipios_1a"]), "validos_1a_leitura": a["validos_1a"],
                         "eleitores": a["eleitores"], "validos": a["validos"], "lula": a["lula"],
                         "saldo": 2 * a["lula"] - a["validos"], "lula_pct": lula_pct,
                         "lula_1t_pct": esp, "dif_1t_pp": _br_dif(_br_div(a["l_base_obs"], a["v_base"]), esp),
                         "esperado_pct": _br_div(a["l_esp"], a["v_esp"]),
                         "dif_pp": _br_dif(_br_div(a["l_esp_obs"], a["v_esp"]), _br_div(a["l_esp"], a["v_esp"])),
                         "abstencao_pct": _br_div(a["eleitores"] - a["comparecimento"], a["eleitores"]),
                         "abstencao_1t_pct": _br_div(a["ab_base"], a["e_base"])})
        regs.sort(key=lambda x: (x["regiao"] == "Total", -x["validos"]))
        out.append({"lote": lt["lote"], "hg": lt["hg"], "regioes": [x for x in regs if x["regiao"] != "Total"],
                    "total": next(x for x in regs if x["regiao"] == "Total")})
    return out


def analise_brasil(ctx: Ctx, u: Unidades, p: dict, n_entradas: int = 40, n_lotes: int = 8) -> dict:
    """De onde vêm os votos, abstenção e 3ª via, nas mesmas urnas (fração apurada de cada município
    aplicada ao 1º turno de 2026 e ao 2º turno de 2022), por região e por UF.

    Abstenção, efeito no saldo: contrafactual em que cada município contado comparece com a taxa do
    1º turno e vota como está votando agora (fatia de Lula e taxa de válidos observadas). Efeito =
    saldo observado − saldo contrafactual, medido na fatia: 2·(S − S')·W = Σ 2·(w − w')·(s − S'),
    com w/w' os válidos observados/contrafactuais, s a fatia de Lula no município e S' a fatia
    nacional contrafactual. Queda uniforme de comparecimento não muda nada; só pesa onde o município
    vota diferente da média.

    3ª via: contabilidade agregada (não é fluxo individual). Com g = eleitores apurados / aptos do
    1º turno, ΔLula + ΔFlávio + Δ(brancos+nulos) + Δabstenção = g·O1 exatamente.
    """
    b1, b22 = ctx.B["2026_1t"], ctx.B["2022_2t"]
    rep = u.vv > 0
    ok1 = rep & b1["tem"] & (b1["aptos"] > 0)
    ok22 = ok1 & b22["tem"] & (b22["aptos"] > 0)
    A1 = np.where(b1["aptos"] > 0, b1["aptos"], 1)
    g = np.where(ok1, u.est / A1, 0.0)
    L, VV, C, EST = u.lula, u.vv, u.c, u.est
    F = VV - L
    BN, AB = np.maximum(C - VV, 0), np.maximum(EST - C, 0)
    L1, D1, O1 = b1["lula"], b1["direita"], b1["outros"]
    BN1 = np.maximum(b1["comparecimento"] - b1["validos"], 0)
    AB1 = np.maximum(b1["aptos"] - b1["comparecimento"], 0)
    AB22 = np.maximum(b22["aptos"] - b22["comparecimento"], 0)
    # abstenção: comparecimento esperado com a taxa do 1º turno, votando como agora
    c_esp = np.where(ok1, EST * b1["comparecimento"] / A1, C)
    w = np.where(ok1, VV, 0.0)
    w_cf = np.where(ok1 & (C > 0), VV * c_esp / np.where(C > 0, C, 1), 0.0)
    s = np.where(rep, L / np.where(rep, VV, 1), 0.0)
    S_cf = float((w_cf * s).sum() / w_cf.sum()) if w_cf.sum() else 0.0
    ef = 2 * (w - w_cf) * (s - S_cf)
    W_tot = float(VV.sum())
    V1_tot = float(b1["validos"].sum())
    tem1 = b1["tem"]
    S1_br = _br_div((L1 * tem1).sum(), ((L1 + D1) * tem1).sum())

    def met(m: np.ndarray) -> dict:
        mr, m1, m22 = m & rep, m & ok1, m & ok22
        te, est = float(u.te[m].sum()), float(EST[m].sum())
        vv, lu = float(VV[mr].sum()), float(L[mr].sum())
        o1 = float((g * O1)[m1].sum())
        dl, df = float((L - g * L1)[m1].sum()), float((F - g * D1)[m1].sum())
        dbn, dab = float((BN - g * BN1)[m1].sum()), float((AB - g * AB1)[m1].sum())
        e = float(ef[m1].sum())
        r = {
            "eleitorado": te, "apurado_pct": _br_div(est, te), "municipios": int(mr.sum()),
            "validos": vv, "lula": lu, "saldo": 2 * lu - vv,
            "parcela_contado_pct": _br_div(vv, W_tot), "parcela_esperada_pct": _br_div(float(b1["validos"][m].sum()), V1_tot),
            "lula_pct": _br_div(lu, vv),
            "lula_1t_pct": _br_div((g * L1)[m1].sum(), (g * (L1 + D1))[m1].sum()),
            "lula_2022_pct": _br_div((g * b22["lula"])[m22].sum(), (g * (b22["lula"] + b22["direita"]))[m22].sum()),
            "lula_1t_final_pct": _br_div((L1 * tem1)[m].sum(), ((L1 + D1) * tem1)[m].sum()),
            "abstencao_pct": _br_div(AB[mr].sum(), EST[mr].sum()),
            "abstencao_1t_pct": _br_div((g * AB1)[m1].sum(), (g * b1["aptos"])[m1].sum()),
            "abstencao_2022_pct": _br_div((g * AB22)[m22].sum(), (g * b22["aptos"])[m22].sum()),
            "comparecimento_extra": float((C - c_esp)[m1].sum()),
            "efeito_abstencao_votos": e, "efeito_abstencao_pp": _br_div(e, 2 * W_tot) if W_tot else None,
            "outros_1t": o1,
            "destino": {k: (_br_div(v, o1) if o1 > 0 else None) for k, v in
                        (("lula", dl), ("flavio", df), ("brancos_nulos", dbn), ("abstencao", dab))},
            "destino_votos": {"lula": dl, "flavio": df, "brancos_nulos": dbn, "abstencao": dab},
            "lula_entre_os_dois_pct": _br_div(dl, dl + df) if dl + df > 0 and dl >= 0 and df >= 0 else None,
        }
        r["abstencao_dif_1t_pp"] = _br_dif(r["abstencao_pct"], r["abstencao_1t_pct"])
        r["abstencao_dif_2022_pp"] = _br_dif(r["abstencao_pct"], r["abstencao_2022_pct"])
        r["lula_dif_1t_pp"] = _br_dif(r["lula_pct"], r["lula_1t_pct"])
        return r

    alpha = p.get("alpha_regiao") or {}
    if isinstance(alpha, list):
        alpha = dict(zip(REGIOES, alpha))
    regioes = []
    for nome in ORDEM_REGIOES:
        if nome not in REGIOES:
            continue
        mreg = ctx.regiao == REGIOES.index(nome)
        if not mreg.any():
            continue
        r = {"regiao": nome, **met(mreg), "alpha_pct": round(float(alpha[nome]), 1) if alpha.get(nome) is not None else None}
        ufs = []
        for uf in dict.fromkeys(ctx.uf[mreg].tolist()):
            if uf == "zz":
                continue
            ufs.append({"uf": uf.upper(), "nome": NOMES_UF.get(uf, uf), **met(ctx.uf == uf)})
        r["ufs"] = sorted(ufs, key=lambda x: -x["eleitorado"])
        regioes.append(r)
    total = met(np.ones(len(ctx.chaves), dtype=bool))
    S1_cont = total["lula_1t_pct"]
    incr = _incrementos(ctx, n_lotes, alpha)
    incr.sort(key=lambda e: (e["_t"], e["eleitores"]), reverse=True)
    entradas = [{k: v for k, v in e.items() if not k.startswith("_")} for e in incr[:n_entradas]]
    return {
        "regioes": regioes, "total": total,
        "geografia": {"lula_1t_contado_pct": S1_cont, "lula_1t_brasil_pct": S1_br, "puxado_pp": _br_dif(S1_cont, S1_br)},
        "abstencao_efeito": {"votos": float(ef.sum()), "pp": _br_div(float(ef.sum()), 2 * W_tot) if W_tot else None,
                             "comparecimento_extra": total["comparecimento_extra"]},
        "entradas": entradas, "lotes": _lotes(incr),
        "n_incrementos": len(incr),
    }


def _ensaio() -> dict | None:
    from pathlib import Path

    p = Path(__file__).resolve().parents[2] / "data" / "ensaio_2022.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def estado(db: DB) -> dict:
    ctx = Ctx(db)
    br, zz = _placar_snap(db, "br"), _placar_snap(db, "zz")
    apurando = bool(br and br["secoes_apur"])
    out: dict = {
        "agora": datetime.now().isoformat(timespec="seconds"),
        "fase": "apurando" if apurando else "pre",
        "min_apurado": 100 * MIN_APURADO,
        "nacional": br, "exterior_oficial": zz,
        "bases_ok": {f: len(v) for f, v in ctx.bases.items()},
        "saude": {r["chave"]: {"ts": r["ts"], "valor": r["valor"]} for r in db.query("SELECT * FROM saude")},
        "eventos": db.query("SELECT * FROM evento ORDER BY rowid DESC LIMIT 15"),
        "coleta": {"bu_secoes": len(ctx.bu_rows), "secoes_ext": sum(ctx.secoes_cidade.values()),
                   "municipios_lidos": sum(1 for m in ctx.mun.values() if m["secoes_apur"])},
        "mercados": mercados(db),
        "ensaio_2022": _ensaio(),
    }
    if not ctx.chaves:
        return out

    # ---------------- Brasil ----------------
    brasil: dict = {"modelos": {}}
    for nome, fonte in MODELOS.items():
        u = ctx.unidades(fonte)
        p = projetar(u, n_boot=300, seed=7)
        if "alpha_regiao" in p:
            p["alpha_regiao"] = dict(zip(REGIOES, p["alpha_regiao"]))
        if "_unid" in p:
            p["por_uf"] = _agrupar(u, p, ctx.uf, NOMES_UF)
        brasil["modelos"][nome] = _limpar(p)
        if nome == "vs_2026_1t":
            brasil["mapa"] = _mapa_br(ctx, u, p)
            brasil["mesmas_urnas"] = ctx.comparar(u)
            por_uf = []
            for gi, uf in enumerate(UFS_TODAS):
                s = ctx.grupo == gi
                c = ctx.comparar(u, s)
                por_uf.append({"uf": uf.upper(), "nome": NOMES_UF[uf], "regiao": tse.REGIAO[uf],
                               "apurado_pct": _pct(float(u.est[s].sum()), float(u.te[s].sum())),
                               "lula_pct": c["lula_pct"], "abstencao_pct": c["abstencao_pct"],
                               "lula_1t_pct": c["2026_1t"]["lula_2v_pct"], "lula_2022_pct": c["2022_2t"]["lula_2v_pct"],
                               "abstencao_1t_pct": c["2026_1t"]["abstencao_pct"],
                               "abstencao_2022_pct": c["2022_2t"]["abstencao_pct"]})
            brasil["por_uf"] = por_uf
            try:  # vai para /api/comparacao (o servidor tira do /api/estado)
                out["_comparacao"] = comparacao.montar(ctx, u)
            except Exception as e:  # noqa: BLE001 - o painel segue sem a comparação
                db.log("aviso", f"comparacao: {e!r}")
            if apurando:
                try:
                    brasil["analise"] = analise_brasil(ctx, u, p)
                except Exception as e:  # noqa: BLE001 - o painel segue sem as análises
                    db.log("aviso", f"analise_brasil: {e!r}")
                try:
                    brasil["crescimento"] = crescimento_brasil(ctx, u)
                except Exception as e:  # noqa: BLE001
                    db.log("aviso", f"crescimento_brasil: {e!r}")
            try:
                var = variaveis_exterior(ctx)
                if var:
                    brasil["cenario"] = cenario_brasil(ctx, var, u if apurando else None)
            except Exception as e:  # noqa: BLE001 - o painel segue sem o cenário
                db.log("aviso", f"cenario_brasil: {e!r}")
    brasil["hist"] = db.query("SELECT * FROM proj_hist WHERE escopo='br' ORDER BY ts")
    serie = db.query("SELECT ts_coleta, hg, secoes_apur, secoes_tot, lula, validos FROM snap "
                     "WHERE abr='br' AND secoes_apur>0 ORDER BY ts_coleta")
    brasil["serie"] = [{"t": r["ts_coleta"], "hg": r["hg"], "apurado": _pct(r["secoes_apur"], r["secoes_tot"]),
                        "lula_pct": _pct(r["lula"], r["validos"])} for r in serie]
    brasil["ref_final"] = resultado_final(ctx, ~ctx.ext)
    out["brasil"] = brasil

    # ---------------- Movimentos dos mercados × exterior ----------------
    b1 = ctx.B["2026_1t"]
    cidades = [{"mun": k[1], "nome": ctx.nome[i], "pais": str(ctx.pais[i]), "iso3": ctx.iso3.get(str(ctx.pais[i])) or "",
                "eleitorado": int(((ctx.ab.get(k) or {}).get("eleitorado")) or b1["aptos"][i]),
                "secoes": ctx.secoes_cidade.get(k[1], 0),
                "t1_2v": (float(b1["lula"][i] / (b1["lula"][i] + b1["direita"][i]))
                          if b1["lula"][i] + b1["direita"][i] > 0 else None)}
               for i, k in enumerate(ctx.chaves) if k[0] == "zz"]
    try:
        out["movimentos"] = movimentos.montar(db, cidades, ctx.bu_rows, brasil["hist"])
    except Exception as e:  # noqa: BLE001 - o painel segue sem a aba de movimentos
        db.log("aviso", f"movimentos: {e!r}")

    # ---------------- Exterior ----------------
    ext: dict = {"modelos": {}}
    for nome, fonte in MODELOS.items():
        u = ctx.unidades(fonte, so_exterior=True)
        p = projetar(u, n_boot=200, seed=3)
        if "lula_pct" in p:
            p["disponivel"] = p["apurado_eleitorado"] >= 0.02  # exterior: 2% do eleitorado já dá leitura útil
            if "alpha_regiao" in p:
                p["alpha_regiao"] = {"Exterior": p["alpha_regiao"][0]}
            p["por_pais"] = _agrupar(u, p, ctx.pais[ctx.ext])
        ext["modelos"][nome] = _limpar(p)
        if nome == "vs_2026_1t":
            ext["mesmas_urnas"] = ctx.comparar(u)
            ext["paises"] = _paises(ctx, u)
    ext["hist"] = historico_exterior(ctx)
    ext["secoes"], ext["secoes_tot"] = len(ctx.bu_rows), sum(ctx.secoes_cidade.values())
    ext["ultimo_bu"] = _quando(ctx.bu_rows[-1]) if ctx.bu_rows else None
    try:
        ext["recentes"], ext["lotes"] = recentes_exterior(ctx)
        ext["placar"] = placar_exterior(ctx)
        ext["crescimento"] = crescimento_exterior(ctx)
    except Exception as e:  # noqa: BLE001 - o painel segue sem o feed
        db.log("aviso", f"recentes do exterior: {e!r}")
        ext["recentes"], ext["lotes"] = [], []
    ext["ref_final"] = resultado_final(ctx, ctx.ext)
    out["exterior"] = ext
    return out


def registrar_hist(db: DB, est: dict) -> None:
    """Grava a projeção do Brasil quando o apurado muda (alimenta o gráfico de convergência)."""
    if est.get("fase") != "apurando":
        return
    ult = db.one("SELECT apurado FROM proj_hist WHERE escopo='br' ORDER BY ts DESC LIMIT 1")
    modelos = (est.get("brasil") or {}).get("modelos", {})
    if not modelos:
        return
    ap0 = 100 * next(iter(modelos.values()))["apurado_eleitorado"]
    if ult and abs(ult["apurado"] - ap0) < 1e-9:
        return
    for nome, p in modelos.items():
        if "lula_pct" not in p:
            continue
        parcial = 100 * p["contado"]["lula"] / max(p["contado"]["validos"], 1)
        db.execute("INSERT OR REPLACE INTO proj_hist VALUES (?,?,?,?,?,?,?,?,?)",
                   (est["agora"], "br", 100 * p["apurado_eleitorado"], parcial, nome,
                    p["lula_pct"], p["p10"], p["p90"], p["prob_lula"]))
