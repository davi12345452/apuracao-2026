"""Gera as geometrias do painel (caminhos SVG já projetados) a partir das malhas brutas em data/geo/.

Entradas (baixadas uma vez):
- data/geo/br_mun.json, br_uf.json: malhas do IBGE (qualidade mínima), GeoJSON
- data/geo/world.json: world-atlas 2.0.2 countries-50m (TopoJSON)
- data/geo/iso.json: i18n-iso-countries codes.json (alfa-2, alfa-3, numérico)

URLs:
- https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio
- (idem com intrarregiao=UF)
- https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json
- https://cdn.jsdelivr.net/npm/i18n-iso-countries@7.11.0/codes.json

Saídas: src/apuracao/web/geo_br.json e geo_mundo.json
"""

from __future__ import annotations

import json
import math
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
GEO = RAIZ / "data" / "geo"
WEB = RAIZ / "src" / "apuracao" / "web"


def caminho(aneis: list[list[tuple[float, float]]], prec: int = 1) -> str:
    """Anéis já projetados → path relativo, arredondado e sem pontos repetidos."""
    m = 10 ** prec
    partes = []
    for anel in aneis:
        pts = []
        for x, y in anel:
            p = (round(x * m), round(y * m))
            if not pts or p != pts[-1]:
                pts.append(p)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts.pop()
        if len(pts) < 3:
            continue
        s = [f"M{pts[0][0] / m:g} {pts[0][1] / m:g}"]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if abs(x1 - x0) > 300 * m:  # salto no antimeridiano: recomeça em vez de riscar o mapa
                s.append(f"M{x1 / m:g} {y1 / m:g}")
            else:
                s.append(f"l{(x1 - x0) / m:g} {(y1 - y0) / m:g}")
        partes.append("".join(s) + "z")
    return "".join(partes).replace(" -", "-")


def area_centro(anel):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(anel, anel[1:] + anel[:1]):
        k = x0 * y1 - x1 * y0
        a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k
    if abs(a) < 1e-12:
        return 0.0, anel[0]
    return abs(a / 2), (cx / (3 * a), cy / (3 * a))


def aneis_geojson(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return [anel for poly in polys for anel in poly]


# ---------------- Brasil ----------------
LON0, LAT0, LAT1 = -74.1, 5.4, -33.9
K = 1000 / ((-28.6 - LON0) * math.cos(math.radians(15)))


def proj_br(lon, lat):
    return (lon - LON0) * K * math.cos(math.radians(15)), (LAT0 - lat) * K


def brasil():
    out = {"w": 1000, "h": round((LAT0 - LAT1) * K), "mun": {}, "uf": {}, "uf_centro": {}}
    for f in json.loads((GEO / "br_mun.json").read_text())["features"]:
        an = [[proj_br(*p) for p in a] for a in aneis_geojson(f["geometry"])]
        out["mun"][f["properties"]["codarea"]] = caminho(an)
    cod_uf = {"11": "ro", "12": "ac", "13": "am", "14": "rr", "15": "pa", "16": "ap", "17": "to", "21": "ma",
              "22": "pi", "23": "ce", "24": "rn", "25": "pb", "26": "pe", "27": "al", "28": "se", "29": "ba",
              "31": "mg", "32": "es", "33": "rj", "35": "sp", "41": "pr", "42": "sc", "43": "rs", "50": "ms",
              "51": "mt", "52": "go", "53": "df"}
    for f in json.loads((GEO / "br_uf.json").read_text())["features"]:
        uf = cod_uf[f["properties"]["codarea"]]
        an = [[proj_br(*p) for p in a] for a in aneis_geojson(f["geometry"])]
        out["uf"][uf] = caminho(an)
        _, c = max((area_centro(a) for a in an), key=lambda t: t[0])
        out["uf_centro"][uf] = [round(c[0], 1), round(c[1], 1)]
    return out


# ---------------- Mundo (Equal Earth) ----------------
A1, A2, A3, A4 = 1.340264, -0.081106, 0.000893, 0.003796
M = math.sqrt(3) / 2
ESC = 1000 / (2 * 2.7064)  # largura ~1000


def proj_mundo(lon, lat):
    lam, phi = math.radians(lon), math.radians(lat)
    th = math.asin(M * math.sin(phi))
    t2 = th * th; t6 = t2 ** 3
    x = lam * math.cos(th) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)))
    y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
    return 500 + x * ESC, 245 - y * ESC


def mundo():
    topo = json.loads((GEO / "world.json").read_text())
    sx, sy = topo["transform"]["scale"]; tx, ty = topo["transform"]["translate"]
    arcos = []
    for arco in topo["arcs"]:
        x = y = 0; pts = []
        for dx, dy in arco:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcos.append(pts)

    def anel(idx):
        pts = []
        for i in idx:
            a = arcos[i] if i >= 0 else arcos[~i][::-1]
            pts.extend(a if not pts else a[1:])
        return pts

    num3 = {n: a3 for _, a3, n, _ in json.loads((GEO / "iso.json").read_text())}
    out = {"w": 1000, "h": 490, "pais": {}, "centro": {}}
    for g in topo["objects"]["countries"]["geometries"]:
        iso = num3.get(g.get("id"))
        if not iso or iso == "ATA" or g["type"] not in ("Polygon", "MultiPolygon"):
            continue
        polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
        an = [[proj_mundo(*p) for p in anel(r)] for poly in polys for r in poly]
        out["pais"][iso] = caminho(an)
        _, c = max((area_centro(a) for a in an), key=lambda t: t[0])
        out["centro"][iso] = [round(c[0], 1), round(c[1], 1)]
    return out


if __name__ == "__main__":
    for nome, dados in (("geo_br.json", brasil()), ("geo_mundo.json", mundo())):
        p = WEB / nome
        p.write_text(json.dumps(dados, separators=(",", ":")), encoding="utf-8")
        print(nome, f"{p.stat().st_size / 1e6:.2f} MB")
