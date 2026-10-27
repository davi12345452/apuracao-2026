"""Gráfico (SVG) da noite de 25/10/2026: contado, projeção com faixa de 80% e resultado final.

Lê data/arquivo/estado.json e grava docs/img/projecao-noite.svg. Só stdlib.

Uso: python scripts/grafico_noite.py
"""

from __future__ import annotations

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
W, H = 960, 460
M = {"l": 64, "r": 190, "t": 56, "b": 58}
Y0, Y1 = 48.0, 56.0
COR = {"texto": "#1f2328", "sec": "#59636e", "grade": "#d8dee4", "contado": "#8c959f", "proj": "#1f2328",
       "faixa": "#1f2328", "alt": "#6639ba", "final": "#cf222e", "fundo": "#ffffff", "flavio": "#0969da"}


def x(v: float) -> float:
    return M["l"] + (W - M["l"] - M["r"]) * v / 100


def y(v: float) -> float:
    return M["t"] + (H - M["t"] - M["b"]) * (Y1 - v) / (Y1 - Y0)


def caminho(pts) -> str:
    return " ".join(f"{'M' if i == 0 else 'L'}{x(a):.1f},{y(b):.1f}" for i, (a, b) in enumerate(pts))


def fmt(v: float, d: int = 1) -> str:
    return f"{v:.{d}f}".replace(".", ",")


def main() -> None:
    e = json.loads((RAIZ / "data" / "arquivo" / "estado.json").read_text())
    b, final = e["brasil"], e["nacional"]["lula_pct"]
    h = sorted((p for p in b["hist"] if p["modelo"] == "vs_2026_1t" and p["apurado"] >= 1), key=lambda p: p["apurado"])
    h22 = sorted((p for p in b["hist"] if p["modelo"] == "vs_2022_2t" and p["apurado"] >= 1), key=lambda p: p["apurado"])
    serie = [(p["apurado"], p["lula_pct"]) for p in b["serie"] if p["apurado"] >= 1]
    cl = lambda v: min(max(v, Y0), Y1)  # noqa: E731

    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif">',
         f'<rect width="{W}" height="{H}" fill="{COR["fundo"]}"/>',
         f'<text x="{M["l"]}" y="26" font-size="17" font-weight="600" fill="{COR["texto"]}">Lula nos votos válidos ao longo da apuração de 25/10/2026</text>',
         f'<text x="{M["l"]}" y="45" font-size="12.5" fill="{COR["sec"]}">Projeção do painel (base: 1º turno de 2026) com faixa de 80%, contra o contado e o resultado final</text>']
    # trecho em que Flávio liderou o contado
    trechos, ini = [], None
    for a, v in serie:
        if v < 50 and ini is None:
            ini = a
        elif v >= 50 and ini is not None:
            trechos.append((ini, a)); ini = None
    for a0, a1 in trechos:
        s.append(f'<rect x="{x(a0):.1f}" y="{M["t"]}" width="{x(a1) - x(a0):.1f}" height="{H - M["t"] - M["b"]}" fill="{COR["flavio"]}" opacity=".07"/>')
        s.append(f'<text x="{(x(a0) + x(a1)) / 2:.1f}" y="{y(Y0) - 8:.1f}" font-size="11.5" text-anchor="middle" fill="{COR["flavio"]}">Flávio à frente no contado ({fmt(a0, 0)}% a {fmt(a1, 0)}% apurado)</text>')
    # grade
    for v in range(int(Y0), int(Y1) + 1):
        forte = v == 50
        s.append(f'<line x1="{M["l"]}" x2="{W - M["r"]}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="{COR["sec"] if forte else COR["grade"]}" stroke-width="1"{" stroke-dasharray=\"4 3\"" if forte else ""}/>')
        s.append(f'<text x="{M["l"] - 8}" y="{y(v) + 4:.1f}" font-size="11.5" text-anchor="end" fill="{COR["sec"]}">{v}%</text>')
    for v in range(0, 101, 10):
        s.append(f'<text x="{x(v):.1f}" y="{H - M["b"] + 18}" font-size="11.5" text-anchor="middle" fill="{COR["sec"]}">{v}%</text>')
    s.append(f'<text x="{(M["l"] + W - M["r"]) / 2:.1f}" y="{H - 14}" font-size="12" text-anchor="middle" fill="{COR["sec"]}">apurado (% do eleitorado nas seções já totalizadas)</text>')
    # faixa, linhas
    banda = [(p["apurado"], cl(p["p90"])) for p in h] + [(p["apurado"], cl(p["p10"])) for p in reversed(h)]
    s.append(f'<path d="{caminho(banda)} Z" fill="{COR["faixa"]}" opacity=".12"/>')
    s.append(f'<path d="{caminho([(a, cl(v)) for a, v in serie])}" fill="none" stroke="{COR["contado"]}" stroke-width="2"/>')
    s.append(f'<path d="{caminho([(p["apurado"], cl(p["p50"])) for p in h22])}" fill="none" stroke="{COR["alt"]}" stroke-width="1.5" stroke-dasharray="2 3"/>')
    s.append(f'<path d="{caminho([(p["apurado"], cl(p["p50"])) for p in h])}" fill="none" stroke="{COR["proj"]}" stroke-width="2"/>')
    s.append(f'<line x1="{M["l"]}" x2="{W - M["r"]}" y1="{y(final):.1f}" y2="{y(final):.1f}" stroke="{COR["final"]}" stroke-width="1.5" stroke-dasharray="6 4"/>')
    # rótulos diretos à direita
    xr = W - M["r"] + 10
    rot = [(y(final), COR["final"], f"resultado final {fmt(final, 2)}%"),
           (y(h[-1]["p50"]) - 16, COR["proj"], "projeção (1º turno 2026)"),
           (y(h22[-1]["p50"]) - 32, COR["alt"], "projeção (2º turno 2022)"),
           (y(serie[-1][1]) + 18, COR["contado"], "contado")]
    for yy, c, t in rot:
        s.append(f'<text x="{xr}" y="{yy + 4:.1f}" font-size="12" font-weight="600" fill="{c}">{t}</text>')
    s.append(f'<rect x="{xr}" y="{y(Y1) + 2:.1f}" width="14" height="9" fill="{COR["faixa"]}" opacity=".12"/>'
             f'<text x="{xr + 20}" y="{y(Y1) + 10:.1f}" font-size="11.5" fill="{COR["sec"]}">faixa de 80%</text>')
    s.append("</svg>")
    out = RAIZ / "docs" / "img" / "projecao-noite.svg"
    out.write_text("\n".join(s))
    print(out)


if __name__ == "__main__":
    main()
