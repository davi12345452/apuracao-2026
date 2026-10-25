"""Cliente HTTP educado: User-Agent identificável, rate limit, retry com backoff e Range."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

#: User-Agent padrão (sem contato pessoal). Ver ``montar_user_agent()``.
USER_AGENT = "analise-urnas/0.1 (+https://github.com/davi12345452/analise-urnas)"
#: Variável de ambiente opcional com um contato (e-mail, URL) acrescentado ao User-Agent.
ENV_CONTATO = "URNAS_CONTATO"
DEFAULT_TIMEOUT = (10, 60)  # (conexão, leitura) em segundos


def montar_user_agent(contato: str | None = None) -> str:
    """User-Agent identificável; com ``URNAS_CONTATO`` (ou ``contato``) definido, vira
    ``analise-urnas/0.1 (+https://github.com/davi12345452/analise-urnas; <contato>)``."""
    if contato is None:
        contato = os.environ.get(ENV_CONTATO, "")
    contato = contato.strip()
    if not contato:
        return USER_AGENT
    return f"{USER_AGENT[:-1]}; {contato})"


class HttpError(RuntimeError):
    """Resposta HTTP inesperada (status ou conteúdo). `status` = código HTTP, se houver."""

    def __init__(self, msg: str, status: int | None = None) -> None:
        super().__init__(msg)
        self.status = status


class HttpClient:
    """Sessão requests com rate limit global (min_interval entre requisições) e retry.

    O retry cobre erros de conexão, timeouts e status 429/5xx, com backoff exponencial
    (backoff_factor * 2**(n-1) segundos) e respeitando Retry-After.
    """

    def __init__(
        self,
        min_interval: float = 0.4,
        retries: int = 5,
        backoff_factor: float = 1.0,
        timeout: tuple[float, float] = DEFAULT_TIMEOUT,
        user_agent: str | None = None,
    ) -> None:
        self.min_interval = min_interval
        self.timeout = timeout
        self._lock = threading.Lock()
        self._last = 0.0
        self.n_requests = 0
        self.session = requests.Session()
        self.session.headers["User-Agent"] = user_agent or montar_user_agent()
        retry = Retry(
            total=retries,
            connect=retries,
            read=retries,
            status=retries,
            backoff_factor=backoff_factor,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET", "HEAD"}),
            respect_retry_after_header=True,
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    def _throttle(self) -> None:
        with self._lock:
            wait = self._last + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            self.n_requests += 1

    def request(self, method: str, url: str, **kw) -> requests.Response:
        """Requisição com throttle; levanta HttpError para status >= 400."""
        self._throttle()
        kw.setdefault("timeout", self.timeout)
        resp = self.session.request(method, url, **kw)
        if resp.status_code >= 400:
            raise HttpError(f"{method} {url} -> HTTP {resp.status_code}", resp.status_code)
        return resp

    def head(self, url: str) -> requests.Response:
        return self.request("HEAD", url, allow_redirects=True)

    def get_bytes(self, url: str) -> bytes:
        return self.request("GET", url).content

    def get_json(self, url: str):
        return self.request("GET", url).json()

    def get_range(self, url: str, start: int, end: int) -> bytes:
        """Baixa os bytes [start, end] (inclusivo). Exige 206 e tamanho exato."""
        resp = self.request("GET", url, headers={"Range": f"bytes={start}-{end}"})
        if resp.status_code != 206:
            raise HttpError(f"Range não suportado em {url} (HTTP {resp.status_code})")
        data = resp.content
        if len(data) != end - start + 1:
            raise HttpError(f"Range {start}-{end} de {url}: recebidos {len(data)} bytes")
        return data

    def download_range(self, url: str, start: int, end: int, dest: Path, chunk: int = 1 << 20) -> Path:
        """Baixa os bytes [start, end] (inclusivo) de url para dest, via dest.part, com resume.

        Se dest.part existir com k bytes, pede só ``bytes=start+k-end`` e acrescenta. Exige 206 e,
        no fim, exatamente ``end - start + 1`` bytes (senão levanta HttpError e mantém o .part).
        Uma requisição por chamada (mais as do retry): blocos grandes custam poucas requisições.
        """
        total = end - start + 1
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and dest.stat().st_size == total:
            return dest
        part = dest.with_name(dest.name + ".part")
        have = part.stat().st_size if part.exists() else 0
        if have > total:
            part.unlink()
            have = 0
        if have < total:
            self._throttle()
            headers = {"Range": f"bytes={start + have}-{end}"}
            with self.session.get(url, headers=headers, stream=True, timeout=self.timeout) as resp:
                if resp.status_code != 206:
                    raise HttpError(f"Range {start + have}-{end} de {url}: HTTP {resp.status_code}", resp.status_code)
                with open(part, "ab") as fh:
                    for block in resp.iter_content(chunk):
                        fh.write(block)
        if part.stat().st_size != total:
            raise HttpError(f"Range {start}-{end} de {url}: {part.stat().st_size} de {total} bytes (rode de novo)")
        part.replace(dest)
        return dest

    def download_file(self, url: str, dest: Path, chunk: int = 1 << 16) -> Path:
        """Baixa url para dest via dest.part, retomando com Range se o .part existir."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        have = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={have}-"} if have else {}
        self._throttle()
        with self.session.get(url, headers=headers, stream=True, timeout=self.timeout) as resp:
            if resp.status_code == 416:  # .part já completo
                part.replace(dest)
                return dest
            if resp.status_code >= 400:
                raise HttpError(f"GET {url} -> HTTP {resp.status_code}", resp.status_code)
            mode = "ab" if have and resp.status_code == 206 else "wb"
            with open(part, mode) as fh:
                for block in resp.iter_content(chunk):
                    fh.write(block)
            # Confere o tamanho quando o corpo veio inteiro e sem compressão de transporte.
            esperado = resp.headers.get("Content-Length")
            if resp.status_code == 200 and esperado and not resp.headers.get("Content-Encoding"):
                if part.stat().st_size != int(esperado):
                    raise HttpError(f"GET {url}: {part.stat().st_size} bytes, Content-Length {esperado}")
        part.replace(dest)
        return dest
