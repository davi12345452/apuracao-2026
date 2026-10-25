"""URLs e parsers dos arquivos do portal resultados.tse.jus.br (2026)."""

from __future__ import annotations

import os

BASE = os.environ.get("APURACAO_TSE_BASE", "https://resultados.tse.jus.br/oficial")
CICLO = "ele2026"
ELE_1T = 6257  # Eleição Ordinária Federal 2026, 1º turno (presidente)
ELE_2T = 6258  # idem, 2º turno
PLEITO_2T = 3221

LULA = "13"
FLAVIO = "22"

UFS = [
    "ac", "al", "am", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms", "mt", "pa", "pb",
    "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc", "se", "sp", "to",
]
REGIAO = {
    "ac": "Norte", "am": "Norte", "ap": "Norte", "pa": "Norte", "ro": "Norte", "rr": "Norte", "to": "Norte",
    "al": "Nordeste", "ba": "Nordeste", "ce": "Nordeste", "ma": "Nordeste", "pb": "Nordeste",
    "pe": "Nordeste", "pi": "Nordeste", "rn": "Nordeste", "se": "Nordeste",
    "df": "Centro-Oeste", "go": "Centro-Oeste", "ms": "Centro-Oeste", "mt": "Centro-Oeste",
    "es": "Sudeste", "mg": "Sudeste", "rj": "Sudeste", "sp": "Sudeste",
    "pr": "Sul", "rs": "Sul", "sc": "Sul",
    "zz": "Exterior",
}


def url_u(uf: str, ele: int = ELE_2T, mun: str | None = None) -> str:
    """Resultado consolidado (br, uf, zz ou município) do cargo presidente."""
    return f"{BASE}/{CICLO}/{ele}/dados/{uf}/{uf}{mun or ''}-c0001-e{ele:06d}-u.json"


def url_ab(uf: str, ele: int = ELE_2T) -> str:
    """Abrangências da UF: seções totalizadas, eleitorado, comparecimento e abstenção por município."""
    return f"{BASE}/{CICLO}/{ele}/dados/{uf}/{uf}-e{ele:06d}-ab.json"


def url_cm(ele: int = ELE_2T) -> str:
    return f"{BASE}/{CICLO}/{ele}/config/mun-e{ele:06d}-cm.json"


def url_cs(uf: str, pleito: int = PLEITO_2T) -> str:
    return f"{BASE}/{CICLO}/arquivo-urna/{pleito}/config/{uf}/{uf}-p{pleito:06d}-cs.json"


def secao_dir(uf: str, mun: str, zona: str, secao: str, pleito: int = PLEITO_2T) -> str:
    return f"{BASE}/{CICLO}/arquivo-urna/{pleito}/dados/{uf}/{mun}/{zona}/{secao}"


def url_aux(uf: str, mun: str, zona: str, secao: str, pleito: int = PLEITO_2T) -> str:
    p = f"{pleito:06d}"
    return f"{secao_dir(uf, mun, zona, secao, pleito)}/p{p}-{uf}-m{mun}-z{zona}-s{secao}-aux.json"


def _i(x) -> int:
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def candidatos(d: dict) -> dict[str, int]:
    """{número: votos} do primeiro cargo de um arquivo -u."""
    out: dict[str, int] = {}
    for carg in d.get("carg") or []:
        for agr in carg.get("agr") or []:
            for par in agr.get("par") or []:
                for c in par.get("cand") or []:
                    out[str(c.get("n"))] = _i(c.get("vap"))
        break
    return out


def parse_u(d: dict) -> dict:
    """Resumo de um arquivo -u: seções, eleitorado, comparecimento, votos."""
    s, e, v = d.get("s") or {}, d.get("e") or {}, d.get("v") or {}
    cand = candidatos(d)
    return {
        "abr": d.get("cdabr"),
        "dg": d.get("dg"),
        "hg": d.get("hg"),
        "ts": _i(s.get("ts")),
        "st": _i(s.get("st")),
        "te": _i(e.get("te")),
        "est": _i(e.get("est")),
        "c": _i(e.get("c")),
        "a": _i(e.get("a")),
        "tv": _i(v.get("tv")),
        "vv": _i(v.get("vv")),
        "vb": _i(v.get("vb")),
        "vn": _i(v.get("tvn")),
        "lula": cand.get(LULA, 0),
        "flavio": cand.get(FLAVIO, 0),
        "cand": cand,
    }


def parse_ab(d: dict) -> list[dict]:
    """Por município: seções totalizadas, eleitorado (total e das seções totalizadas), comparecimento."""
    out = []
    for a in d.get("abr") or []:
        s, e = a.get("s") or {}, a.get("e") or {}
        out.append({
            "mun": a.get("cdabr"),
            "and": a.get("and"),
            "ts": _i(s.get("ts")),
            "st": _i(s.get("st")),
            "te": _i(e.get("te")),
            "est": _i(e.get("est")),
            "c": _i(e.get("c")),
            "a": _i(e.get("a")),
        })
    return out


def secoes_cs(d: dict) -> list[tuple[str, str, str, str]]:
    """(mun, nome do município, zona, seção) das seções com arquivo próprio (sem as agregadas "nsp")."""
    out = []
    for abr in d.get("abr") or []:
        for m in abr.get("mu") or []:
            for z in m.get("zon") or []:
                for s in z.get("sec") or []:
                    if "nsp" not in s:
                        out.append((m["cd"], m["nm"], z["cd"], s["ns"]))
    return out


def resumo_bu(bu: dict) -> dict:
    """Totais do presidente num BU já decodificado por analise_urnas.parsers.bu.parse_bu."""
    tot = None
    for e in bu.get("eleicoes") or []:
        for r in e.get("resultados") or []:
            for c in r.get("cargos") or []:
                if c.get("codigo_cargo") == 1:
                    tot = c.get("totais") or {}
    tot = tot or {}
    nom = tot.get("nominal") or {}
    return {
        "aptos": bu.get("eleitores_aptos") or 0,
        "comparecimento": bu.get("comparecimento") or 0,
        "lula": nom.get(LULA, 0),
        "flavio": nom.get(FLAVIO, 0),
        "brancos": tot.get("branco", 0),
        "nulos": tot.get("nulo", 0),
        "encerramento": bu.get("data_hora_encerramento"),
        "emissao": bu.get("data_hora_emissao"),
    }
