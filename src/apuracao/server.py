"""Servidor local do painel: arquivos de web/ e /api/estado (cache de alguns segundos).

Uso: python -m apuracao.server [--porta 8000]
"""

from __future__ import annotations

import argparse
import gzip
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
# na internet (Railway): eventos sem traceback, que expõe caminhos e código
PUBLICO = os.environ.get("APURACAO_PUBLICO") == "1"
SEGURANCA = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; "
                               "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
                               "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
}
GZIP_TIPOS = (".js", ".css", ".json", ".html")


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
        self.corpo_gz = gzip.compress(self.corpo)
        self.fixos = b"[]"  # nome, UF, eleitorado e 1º turno dos municípios: o navegador baixa uma vez só
        self.fixos_gz = gzip.compress(self.fixos)
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
                    est = self._separar_fixos(est)
                    if PUBLICO:
                        est = {**est, "eventos": [{**e, "msg": str(e.get("msg", "")).split("\n")[0][:300]} for e in est.get("eventos") or []]}
                    self.corpo = json.dumps(est, ensure_ascii=False, default=_json).encode()
                    self.corpo_gz = gzip.compress(self.corpo, 6)
                except Exception:  # noqa: BLE001 - mantém o último bom e registra
                    self.db.log("erro", "painel: " + traceback.format_exc(limit=3))
                self.t = time.monotonic()
            return self.corpo

    def _separar_fixos(self, est: dict) -> dict:
        """Linha do mapa [ibge, nome, uf, eleitorado, apurado, contado, projetado, desvio, 1º turno]
        vira [ibge, apurado, contado, projetado, desvio] no estado; o resto vai para /api/municipios."""
        mapa = (est.get("brasil") or {}).get("mapa")
        if not mapa:
            return est
        if self.fixos == b"[]":
            self.fixos = json.dumps([[r[0], r[1], r[2], r[3], r[8]] for r in mapa], ensure_ascii=False).encode()
            self.fixos_gz = gzip.compress(self.fixos, 6)
        return {**est, "brasil": {**est["brasil"], "mapa": [[r[0], r[4], r[5], r[6], r[7]] for r in mapa]}}

    def get_gz(self) -> bytes:
        self.get()
        return self.corpo_gz


_GZ_ESTATICO: dict[str, tuple[float, bytes]] = {}


def _estatico_gz(arq: Path) -> bytes:
    """Arquivo do painel compactado, refeito só quando o arquivo muda."""
    m = arq.stat().st_mtime
    c = _GZ_ESTATICO.get(str(arq))
    if not c or c[0] != m:
        c = (m, gzip.compress(arq.read_bytes(), 6))
        _GZ_ESTATICO[str(arq)] = c
    return c[1]


def handler(est: Estado):
    class H(SimpleHTTPRequestHandler):
        server_version = "apuracao"
        sys_version = ""
        timeout = 30  # conexão parada não prende uma thread para sempre

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(WEB), **kw)

        def _aceita_gzip(self) -> bool:
            return "gzip" in (self.headers.get("Accept-Encoding") or "")

        def _enviar(self, corpo: bytes, tipo: str, gz: bool, cache: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", tipo)
            self.send_header("Cache-Control", cache)
            self.send_header("Vary", "Accept-Encoding")
            if gz:
                self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(corpo)

        def do_GET(self):  # noqa: N802
            caminho = self.path.split("?", 1)[0].split("#", 1)[0]
            if caminho == "/api/estado":
                gz = self._aceita_gzip()
                self._enviar(est.get_gz() if gz else est.get(), "application/json; charset=utf-8", gz, "no-store")
                return
            if caminho == "/api/municipios":
                est.get()
                gz = self._aceita_gzip()
                self._enviar(est.fixos_gz if gz else est.fixos, "application/json; charset=utf-8", gz, "no-cache")
                return
            if caminho.startswith("/api/"):
                self.send_error(404)
                return
            arq = Path(self.translate_path(caminho if caminho != "/" else "/index.html"))
            if self._aceita_gzip() and arq.suffix in GZIP_TIPOS and arq.is_file() and arq.resolve().is_relative_to(WEB):
                self._enviar(_estatico_gz(arq), self.guess_type(str(arq)), True, "no-cache")
                return
            super().do_GET()

        def do_HEAD(self):  # noqa: N802
            self.do_GET()

        def list_directory(self, path):  # sem listagem de pastas
            self.send_error(404)
            return None

        def end_headers(self):
            for k, v in SEGURANCA.items():
                self.send_header(k, v)
            if not self.path.startswith("/api/") and not self._headers_buffer_tem("Cache-Control"):
                self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def _headers_buffer_tem(self, nome: str) -> bool:
            alvo = nome.lower().encode()
            return any(alvo in linha.lower() for linha in getattr(self, "_headers_buffer", []))

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
    srv.daemon_threads = True
    print(f"painel em http://{a.host}:{a.porta}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
