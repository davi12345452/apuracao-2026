"""Servidor local do painel: arquivos de web/ e /api/estado (cache de alguns segundos).

Uso: python -m apuracao.server [--porta 8000]
"""

from __future__ import annotations

import argparse
import os
import json
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import alertas
from .db import DB
from .painel import estado, registrar_hist

WEB = Path(__file__).resolve().parent / "web"
CACHE_S = 8


def _json(x):
    if hasattr(x, "item"):  # escalares numpy
        return x.item()
    return str(x)


class Estado:
    def __init__(self, db: DB) -> None:
        self.db = db
        self.lock = threading.Lock()
        self.t = 0.0
        self.corpo = b"{}"
        self.ultimo: dict | None = None

    def vigiar(self, intervalo: float = 60.0) -> None:
        """Recalcula o estado sem depender do navegador e manda os avisos do Telegram."""
        while True:
            try:
                self.get()
                if self.ultimo:
                    alertas.verificar(self.db, self.ultimo)
            except Exception:  # noqa: BLE001 - aviso nunca derruba o servidor
                self.db.log("aviso", "alertas: " + traceback.format_exc(limit=2))
            time.sleep(intervalo)

    def get(self) -> bytes:
        with self.lock:
            if time.monotonic() - self.t > CACHE_S:
                try:
                    est = estado(self.db)
                    registrar_hist(self.db, est)
                    self.ultimo = est
                    self.corpo = json.dumps(est, ensure_ascii=False, default=_json).encode()
                except Exception:  # noqa: BLE001 - mantém o último bom e registra
                    self.db.log("erro", "painel: " + traceback.format_exc(limit=3))
                self.t = time.monotonic()
            return self.corpo


def handler(est: Estado):
    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(WEB), **kw)

        def do_GET(self):  # noqa: N802
            if self.path.startswith("/api/estado"):
                corpo = est.get()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)
                return
            super().do_GET()

        def end_headers(self):
            if not self.path.startswith("/api/"):
                self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def log_message(self, *a):
            pass

    return H


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--porta", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default=os.environ.get("APURACAO_HOST", "127.0.0.1"))
    ap.add_argument("--sem-alertas", action="store_true", help="não manda avisos no Telegram (só a porta 8000 manda)")
    a = ap.parse_args(argv)
    est = Estado(DB())
    # avisos: por padrão só o servidor principal (porta 8000); APURACAO_ALERTAS=1/0 decide no container
    alertas_on = os.environ.get("APURACAO_ALERTAS", "1" if a.porta == 8000 else "0") == "1"
    if alertas_on and not a.sem_alertas:
        threading.Thread(target=est.vigiar, daemon=True).start()
    srv = ThreadingHTTPServer((a.host, a.porta), handler(est))
    print(f"painel em http://{a.host}:{a.porta}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
