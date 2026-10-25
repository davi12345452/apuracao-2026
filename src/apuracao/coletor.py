"""Processo coletor: exterior por BU (contínuo) + totalização oficial (a cada ~20 s).

Uso: python -m apuracao.coletor   (roda até Ctrl+C)
"""

from __future__ import annotations

import argparse
import json
import threading
import time

from . import exterior, mercados, oficial
from .db import DB


def loop_exterior(db: DB, parar: threading.Event, workers: int, pausa: float) -> None:
    http = exterior.cliente(0.15)
    while not parar.is_set():
        try:
            if not db.one("SELECT 1 FROM secao_ext LIMIT 1"):
                exterior.preparar(db, http)
            r = exterior.varrer(db, http, workers=workers)
            db.log("info", f"exterior: {r}")
            db.batida("exterior", json.dumps(r))
            if r["pendentes"] and r["pendentes"] == r["novos"]:
                db.log("info", "exterior: todas as seções com BU")
                return
            if r["pendentes"] == 0:
                return
        except Exception as e:  # noqa: BLE001
            db.log("erro", f"loop_exterior: {e!r}")
        parar.wait(pausa)


def loop_oficial(db: DB, parar: threading.Event, pausa: float, ufs_cada: float) -> None:
    http = exterior.cliente(0.1)
    ultimo_hg = None
    ultimo_ufs = 0.0
    while not parar.is_set():
        try:
            topo = oficial.ciclo_topo(db, http)
            db.batida("oficial", json.dumps({k: {"hg": v.get("hg"), "st": v.get("st")} for k, v in topo.items()}))
            hg = (topo.get("br") or {}).get("hg")
            apurou = (topo.get("br") or {}).get("st", 0) > 0 or (topo.get("zz") or {}).get("st", 0) > 0
            intervalo = ufs_cada if apurou else 600
            if hg != ultimo_hg or time.monotonic() - ultimo_ufs > intervalo:
                r = oficial.ciclo_ufs(db, http)
                ultimo_ufs = time.monotonic()
                ultimo_hg = hg
                db.log("info", f"oficial br {hg}: {r}")
        except Exception as e:  # noqa: BLE001
            db.log("erro", f"loop_oficial: {e!r}")
        parar.wait(pausa)


def loop_mercados(db: DB, parar: threading.Event, pausa: float) -> None:
    while not parar.is_set():
        try:
            mercados.coletar(db)
        except Exception as e:  # noqa: BLE001
            db.log("erro", f"loop_mercados: {e!r}")
        parar.wait(pausa)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-exterior", action="store_true")
    ap.add_argument("--sem-oficial", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--pausa-exterior", type=float, default=30)
    ap.add_argument("--pausa-oficial", type=float, default=20)
    ap.add_argument("--ufs-cada", type=float, default=60)
    ap.add_argument("--sem-mercados", action="store_true")
    ap.add_argument("--pausa-mercados", type=float, default=60)
    a = ap.parse_args(argv)
    db = DB()
    parar = threading.Event()
    th = []
    if not a.sem_exterior:
        th.append(threading.Thread(target=loop_exterior, args=(db, parar, a.workers, a.pausa_exterior), daemon=True))
    if not a.sem_oficial:
        th.append(threading.Thread(target=loop_oficial, args=(db, parar, a.pausa_oficial, a.ufs_cada), daemon=True))
    if not a.sem_mercados:
        th.append(threading.Thread(target=loop_mercados, args=(db, parar, a.pausa_mercados), daemon=True))
    for t in th:
        t.start()
    db.log("info", "coletor iniciado")
    try:
        while any(t.is_alive() for t in th):
            time.sleep(1)
    except KeyboardInterrupt:
        parar.set()


if __name__ == "__main__":
    main()
