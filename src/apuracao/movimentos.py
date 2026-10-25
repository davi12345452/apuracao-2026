"""Movimentos dos mercados ao longo do dia, cruzados com o que aconteceu no exterior.

- Fechamento: as seções do exterior votam das 8h às 17h no horário local. O horário local de cada
  cidade vem de um fuso por país (com exceções por cidade nos países com mais de um fuso).
- Episódios: janelas em que a chance de Lula (média Polymarket/Kalshi) andou pelo menos LIMIAR_PP
  em JANELA_MIN minutos. Para cada episódio listamos quem fechou e quais boletins chegaram perto dele.
  Coincidência no tempo não prova causa: o painel mostra lado a lado, a leitura é de quem olha.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

BRT = ZoneInfo("America/Sao_Paulo")
DIA = date(2026, 10, 25)
FECHA_LOCAL = 17  # hora local de encerramento das seções
JANELA_MIN = 30
LIMIAR_PP = 1.5
ANTES_MIN = 60  # fechamentos até 1 h antes do episódio contam como "perto"

FUSO_PAIS = {
    "AGO": "Africa/Luanda", "ALB": "Europe/Tirane", "ARE": "Asia/Dubai", "ARG": "America/Argentina/Buenos_Aires",
    "ARM": "Asia/Yerevan", "ATG": "America/Antigua", "AUS": "Australia/Sydney", "AUT": "Europe/Vienna",
    "AZE": "Asia/Baku", "BEL": "Europe/Brussels", "BEN": "Africa/Porto-Novo", "BFA": "Africa/Ouagadougou",
    "BGD": "Asia/Dhaka", "BGR": "Europe/Sofia", "BHR": "Asia/Bahrain", "BHS": "America/Nassau",
    "BIH": "Europe/Sarajevo", "BLZ": "America/Belize", "BOL": "America/La_Paz", "BRB": "America/Barbados",
    "BWA": "Africa/Gaborone", "CAN": "America/Toronto", "CHE": "Europe/Zurich", "CHL": "America/Santiago",
    "CHN": "Asia/Shanghai", "CIV": "Africa/Abidjan", "CMR": "Africa/Douala", "COD": "Africa/Kinshasa",
    "COG": "Africa/Brazzaville", "COL": "America/Bogota", "CPV": "Atlantic/Cape_Verde", "CRI": "America/Costa_Rica",
    "CUB": "America/Havana", "CYP": "Asia/Nicosia", "CZE": "Europe/Prague", "DEU": "Europe/Berlin",
    "DNK": "Europe/Copenhagen", "DOM": "America/Santo_Domingo", "DZA": "Africa/Algiers", "ECU": "America/Guayaquil",
    "EGY": "Africa/Cairo", "ESP": "Europe/Madrid", "EST": "Europe/Tallinn", "ETH": "Africa/Addis_Ababa",
    "FIN": "Europe/Helsinki", "FRA": "Europe/Paris", "GAB": "Africa/Libreville", "GBR": "Europe/London",
    "GEO": "Asia/Tbilisi", "GHA": "Africa/Accra", "GIN": "Africa/Conakry", "GNB": "Africa/Bissau",
    "GNQ": "Africa/Malabo", "GRC": "Europe/Athens", "GTM": "America/Guatemala", "GUY": "America/Guyana",
    "HND": "America/Tegucigalpa", "HRV": "Europe/Zagreb", "HTI": "America/Port-au-Prince", "HUN": "Europe/Budapest",
    "IDN": "Asia/Jakarta", "IND": "Asia/Kolkata", "IRL": "Europe/Dublin", "IRN": "Asia/Tehran",
    "IRQ": "Asia/Baghdad", "ISR": "Asia/Jerusalem", "ITA": "Europe/Rome", "JAM": "America/Jamaica",
    "JOR": "Asia/Amman", "JPN": "Asia/Tokyo", "KAZ": "Asia/Almaty", "KEN": "Africa/Nairobi", "KOR": "Asia/Seoul",
    "KWT": "Asia/Kuwait", "LBN": "Asia/Beirut", "LBY": "Africa/Tripoli", "LCA": "America/St_Lucia",
    "LKA": "Asia/Colombo", "MAR": "Africa/Casablanca", "MEX": "America/Mexico_City", "MLI": "Africa/Bamako",
    "MMR": "Asia/Yangon", "MOZ": "Africa/Maputo", "MWI": "Africa/Blantyre", "MYS": "Asia/Kuala_Lumpur",
    "NAM": "Africa/Windhoek", "NGA": "Africa/Lagos", "NIC": "America/Managua", "NLD": "Europe/Amsterdam",
    "NOR": "Europe/Oslo", "NPL": "Asia/Kathmandu", "NZL": "Pacific/Auckland", "OMN": "Asia/Muscat",
    "PAK": "Asia/Karachi", "PAN": "America/Panama", "PER": "America/Lima", "PHL": "Asia/Manila",
    "POL": "Europe/Warsaw", "PRK": "Asia/Pyongyang", "PRT": "Europe/Lisbon", "PRY": "America/Asuncion",
    "PSE": "Asia/Hebron", "QAT": "Asia/Qatar", "ROU": "Europe/Bucharest", "RUS": "Europe/Moscow",
    "SAU": "Asia/Riyadh", "SEN": "Africa/Dakar", "SGP": "Asia/Singapore", "SLV": "America/El_Salvador",
    "SRB": "Europe/Belgrade", "STP": "Africa/Sao_Tome", "SUR": "America/Paramaribo", "SVK": "Europe/Bratislava",
    "SVN": "Europe/Ljubljana", "SWE": "Europe/Stockholm", "SYR": "Asia/Damascus", "TGO": "Africa/Lome",
    "THA": "Asia/Bangkok", "TLS": "Asia/Dili", "TTO": "America/Port_of_Spain", "TUN": "Africa/Tunis",
    "TUR": "Europe/Istanbul", "TWN": "Asia/Taipei", "TZA": "Africa/Dar_es_Salaam", "UKR": "Europe/Kyiv",
    "URY": "America/Montevideo", "USA": "America/New_York", "VEN": "America/Caracas", "VNM": "Asia/Ho_Chi_Minh",
    "ZAF": "Africa/Johannesburg", "ZMB": "Africa/Lusaka", "ZWE": "Africa/Harare",
}
FUSO_CIDADE = {
    "CHICAGO": "America/Chicago", "HOUSTON": "America/Chicago", "LOS ANGELES": "America/Los_Angeles",
    "SÃO FRANCISCO": "America/Los_Angeles", "VANCOUVER": "America/Vancouver", "CÓRDOBA": "America/Argentina/Cordoba",
    "MENDOZA": "America/Argentina/Mendoza", "CAIENA": "America/Cayenne", "ST GEORGES DE LOYAPOCK": "America/Cayenne",
    "IQUITOS": "America/Lima", "COBIJA": "America/La_Paz",
}
REGIAO_FUSO = [  # rótulo da onda pelo continente do fuso
    ("Asia/", "Ásia"), ("Australia/", "Oceania"), ("Pacific/", "Oceania"), ("Europe/", "Europa"),
    ("Africa/", "África"), ("Atlantic/", "África"), ("America/", "Américas"),
]


def _min_do_dia(dt: datetime) -> float:
    """Minutos desde 00:00 de DIA no horário de Brasília (pode ser negativo ou passar de 1440)."""
    base = datetime(DIA.year, DIA.month, DIA.day, tzinfo=BRT)
    return (dt.astimezone(BRT) - base).total_seconds() / 60


def _min_iso(iso: str) -> float:
    return _min_do_dia(datetime.fromisoformat(iso).replace(tzinfo=BRT))


def _min_epoch(ts: int) -> float:
    return _min_do_dia(datetime.fromtimestamp(ts, tz=BRT))


def _bu_min(r: dict) -> float | None:
    t = r.get("recebido_tse") or ""
    if len(t) < 19:
        return _min_iso(r["baixado_em"]) if r.get("baixado_em") else None
    return _min_iso(f"{t[6:10]}-{t[3:5]}-{t[0:2]}T{t[11:19]}")


def fechamentos(cidades: list[dict], bu_rows: list[dict]) -> list[dict]:
    """cidades: [{mun, nome, pais, iso3, eleitorado}] → horário de fechamento em Brasília e primeiro BU."""
    primeiro: dict[str, float] = {}
    n_bu: dict[str, int] = defaultdict(int)
    for r in bu_rows:
        m = _bu_min(r)
        if m is None:
            continue
        n_bu[r["mun"]] += 1
        primeiro[r["mun"]] = min(primeiro.get(r["mun"], m), m)
    out = []
    for c in cidades:
        tz = FUSO_CIDADE.get(c["nome"]) or FUSO_PAIS.get(c["iso3"]) or "America/Sao_Paulo"
        fecha = datetime(DIA.year, DIA.month, DIA.day, FECHA_LOCAL, tzinfo=ZoneInfo(tz))
        regiao = next((r for p, r in REGIAO_FUSO if tz.startswith(p)), "?")
        out.append({"mun": c["mun"], "cidade": c["nome"].title(), "pais": c["pais"], "iso3": c["iso3"],
                    "eleitorado": c["eleitorado"], "fuso": tz, "regiao": regiao,
                    "fecha_min": round(_min_do_dia(fecha), 1), "primeiro_bu_min": primeiro.get(c["mun"]),
                    "bus": n_bu.get(c["mun"], 0), "secoes": c.get("secoes", 0)})
    out.sort(key=lambda x: x["fecha_min"])
    return out


ANTES_ONDA, DEPOIS_ONDA = 15, 90  # reação do mercado: de 15 min antes a 90 min depois do fechamento


def _valor(s: list[tuple[float, float]], t: float) -> float | None:
    v = None
    for tt, vv in s:
        if tt > t:
            break
        v = vv
    return v


def ondas(fech: list[dict], bu_rows: list[dict], t1_2v: dict[str, float], agora: float,
          mercado: dict[str, list[tuple[float, float]]]) -> list[dict]:
    """Agrupa fechamentos no mesmo horário em 'ondas', com o resultado dos boletins dessas cidades
    (e o 1º turno nas mesmas cidades, ponderado pelos votos contados) e a reação do mercado."""
    por: dict[float, list[dict]] = defaultdict(list)
    for f in fech:
        por[f["fecha_min"]].append(f)
    votos: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in bu_rows:
        votos[r["mun"]][0] += r["lula"] or 0
        votos[r["mun"]][1] += r["flavio"] or 0
    out = []
    for m, fs in sorted(por.items()):
        paises: dict[str, int] = defaultdict(int)
        for f in fs:
            paises[f["pais"]] += f["eleitorado"]
        L = sum(votos[f["mun"]][0] for f in fs)
        F = sum(votos[f["mun"]][1] for f in fs)
        esp = sum((votos[f["mun"]][0] + votos[f["mun"]][1]) * t1_2v.get(f["mun"], 0) for f in fs)
        o = {"min": m, "eleitorado": sum(f["eleitorado"] for f in fs), "cidades": len(fs),
             "paises": [p for p, _ in sorted(paises.items(), key=lambda x: -x[1])],
             "regioes": sorted({f["regiao"] for f in fs}), "bus": sum(f["bus"] for f in fs),
             "secoes": sum(f.get("secoes", 0) for f in fs),
             "lula": L, "flavio": F, "lula_pct": 100 * L / (L + F) if L + F else None,
             "lula_1t_pct": 100 * esp / (L + F) if L + F else None,
             "fechou": m <= agora}
        if m - ANTES_ONDA <= agora:
            fim = min(m + DEPOIS_ONDA, agora)
            o["mercado"] = {k: [_valor(s, m - ANTES_ONDA), _valor(s, fim)] for k, s in mercado.items()}
            o["mercado_ate"] = fim
        out.append(o)
    return out


def serie_exterior(bu_rows: list[dict], pais_de: dict[str, str]) -> list[dict]:
    """Votos do exterior acumulados na ordem de chegada ao TSE."""
    pts = []
    L = F = 0
    for r in sorted(bu_rows, key=lambda r: _bu_min(r) or 0):
        m = _bu_min(r)
        if m is None:
            continue
        L += r["lula"] or 0
        F += r["flavio"] or 0
        pts.append({"min": round(m, 2), "lula": L, "flavio": F, "pais": pais_de.get(r["mun"], "?")})
    return pts


def _grade(series: dict[str, list[tuple[float, float]]], passo: float = 5) -> list[tuple[float, float]]:
    """Média das séries disponíveis numa grade regular (último valor conhecido de cada uma)."""
    tudo = sorted({round(t / passo) * passo for s in series.values() for t, _ in s})
    if not tudo:
        return []
    idx = {k: 0 for k in series}
    ult: dict[str, float | None] = {k: None for k in series}
    out = []
    for g in tudo:
        for k, s in series.items():
            while idx[k] < len(s) and s[idx[k]][0] <= g:
                ult[k] = s[idx[k]][1]
                idx[k] += 1
        vals = [v for v in ult.values() if v is not None]
        if vals:
            out.append((g, sum(vals) / len(vals)))
    return out


def episodios(chance: list[tuple[float, float]], fech: list[dict], ext: list[dict], fatia: list[tuple[float, float]],
              poly: list[tuple[float, float]], kalshi: list[tuple[float, float]]) -> list[dict]:
    """Janelas em que a chance média andou ≥ LIMIAR_PP em JANELA_MIN minutos (episódios encostados se fundem)."""
    if len(chance) < 2:
        return []
    marcas = []
    j = 0
    for i, (t, v) in enumerate(chance):
        while chance[j][0] < t - JANELA_MIN:
            j += 1
        if j < i and abs(v - chance[j][1]) >= LIMIAR_PP:
            marcas.append((chance[j][0], t))
    janelas: list[list[float]] = []
    for a, b in marcas:
        if janelas and a <= janelas[-1][1]:
            janelas[-1][1] = max(janelas[-1][1], b)
        else:
            janelas.append([a, b])

    valor = _valor

    out = []
    for a, b in janelas:
        # aperta a janela: do ponto mais baixo/alto antes ao extremo depois
        dentro = [(t, v) for t, v in chance if a <= t <= b]
        v0, v1 = dentro[0][1], dentro[-1][1]
        fechou = [f for f in fech if a - ANTES_MIN <= f["fecha_min"] <= b]
        por_pais: dict[str, int] = defaultdict(int)
        for f in fechou:
            por_pais[f["pais"]] += f["eleitorado"]
        e0 = next((p for p in reversed(ext) if p["min"] <= a - JANELA_MIN), None)
        e1 = next((p for p in reversed(ext) if p["min"] <= b), None)
        dl = (e1["lula"] - (e0["lula"] if e0 else 0)) if e1 else 0
        dfl = (e1["flavio"] - (e0["flavio"] if e0 else 0)) if e1 else 0
        bus = [p for p in ext if a - JANELA_MIN < p["min"] <= b]
        paises_bu: dict[str, int] = defaultdict(int)
        for p in bus:
            paises_bu[p["pais"]] += 1
        f0, f1 = valor(fatia, a), valor(fatia, b)
        out.append({
            "de": a, "ate": b, "chance_de": v0, "chance_ate": v1, "delta": v1 - v0,
            "poly": [valor(poly, a), valor(poly, b)], "kalshi": [valor(kalshi, a), valor(kalshi, b)],
            "margem": [None if f0 is None else 2 * f0 - 100, None if f1 is None else 2 * f1 - 100],
            "fecharam": [{"pais": p, "eleitorado": e} for p, e in sorted(por_pais.items(), key=lambda x: -x[1])],
            "fecharam_eleitorado": sum(por_pais.values()),
            "boletins": len(bus), "bu_lula": dl, "bu_flavio": dfl,
            "bu_paises": [p for p, _ in sorted(paises_bu.items(), key=lambda x: -x[1])][:5],
        })
    return out


def montar(db, cidades: list[dict], bu_rows: list[dict], proj_hist: list[dict]) -> dict:
    def serie(fonte, nome, f=lambda v: v):
        rows = db.query("SELECT ts, valor FROM mercado_serie WHERE fonte=? AND serie=? ORDER BY ts", (fonte, nome))
        return [(round(_min_epoch(r["ts"]), 2), f(r["valor"])) for r in rows if r["valor"] is not None]

    pct = lambda v: 100 * v  # noqa: E731
    poly, kalshi = serie("polymarket", "vencedor", pct), serie("kalshi", "vencedor", pct)
    poly_ext, kalshi_ext = serie("polymarket", "exterior", pct), serie("kalshi", "exterior", pct)
    fatia = serie("kalshi", "fatia_mediana")
    pais_de = {c["mun"]: c["pais"] for c in cidades}
    fech = fechamentos(cidades, bu_rows)
    ext = serie_exterior(bu_rows, pais_de)
    chance = _grade({"p": poly, "k": kalshi})
    agora = _min_do_dia(datetime.now(tz=BRT))
    # o dia começa à meia-noite; antes disso fica só como contexto do primeiro valor
    corta = lambda s: [p for p in s if p[0] >= -60]  # noqa: E731
    nosso = [{"min": round(_min_iso(h["ts"]), 2), "prob": h["prob"], "p50": h["p50"]}
             for h in proj_hist if h.get("modelo") == "vs_2026_1t"]
    return {
        "agora_min": round(agora, 1),
        "series": {"poly": corta(poly), "kalshi": corta(kalshi), "poly_ext": corta(poly_ext),
                   "kalshi_ext": corta(kalshi_ext), "fatia": corta(fatia)},
        "nosso": nosso,
        "exterior": ext,
        "fechamentos": fech,
        "ondas": ondas(fech, bu_rows, {c["mun"]: c["t1_2v"] for c in cidades if c.get("t1_2v") is not None}, agora,
                       {"chance": chance, "poly": poly, "kalshi": kalshi,
                        "margem": [(t, 2 * v - 100) for t, v in fatia],
                        "poly_ext": poly_ext, "kalshi_ext": kalshi_ext}),
        "episodios": [e for e in episodios(chance, fech, ext, fatia, poly, kalshi) if e["ate"] >= -60],
        "limiar_pp": LIMIAR_PP, "janela_min": JANELA_MIN,
    }
