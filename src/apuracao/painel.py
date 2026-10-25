"""Monta o estado do painel a partir do SQLite: placar, projeções explicadas, exterior e mercados."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime

import numpy as np

from . import tse
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
    brasil["hist"] = db.query("SELECT * FROM proj_hist WHERE escopo='br' ORDER BY ts")
    serie = db.query("SELECT ts_coleta, hg, secoes_apur, secoes_tot, lula, validos FROM snap "
                     "WHERE abr='br' AND secoes_apur>0 ORDER BY ts_coleta")
    brasil["serie"] = [{"t": r["ts_coleta"], "hg": r["hg"], "apurado": _pct(r["secoes_apur"], r["secoes_tot"]),
                        "lula_pct": _pct(r["lula"], r["validos"])} for r in serie]
    out["brasil"] = brasil

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
