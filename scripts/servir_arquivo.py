"""Painel com o retrato final da noite de 25/10/2026, sem coletor nem banco.

Serve o front de src/apuracao/web e responde /api/* com os JSON salvos em data/arquivo/
(o último estado que o painel publicou, às 22h02, com 99,98% apurado).

Uso: python scripts/servir_arquivo.py [--porta 8000]
"""

from __future__ import annotations

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "src" / "apuracao" / "web"
ARQUIVO = RAIZ / "data" / "arquivo"
ROTAS = {"/api/estado": "estado.json", "/api/municipios": "municipios.json", "/api/comparacao": "comparacao.json"}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json"}

    def do_GET(self):
        caminho = self.path.split("?", 1)[0]
        if caminho in ROTAS:
            corpo = (ARQUIVO / ROTAS[caminho]).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--porta", type=int, default=8000)
    a = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", a.porta), functools.partial(Handler, directory=str(WEB)))
    print(f"painel (arquivo de 25/10/2026): http://127.0.0.1:{a.porta}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
