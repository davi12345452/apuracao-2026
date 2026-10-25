"""Leitura de membros de um ZIP remoto (zip64 incluso) via HTTP Range, sem baixar o arquivo inteiro.

Fluxo: lê o final do arquivo (EOCD / zip64 EOCD) para achar o diretório central, guarda o
diretório central em cache local e, para cada membro, baixa só o local file header + dados
comprimidos, infla e confere CRC32 e tamanho.
"""

from __future__ import annotations

import json
import struct
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator

from .httpclient import HttpClient

SIG_CDH = b"PK\x01\x02"
SIG_LFH = b"PK\x03\x04"
SIG_EOCD = b"PK\x05\x06"
SIG_Z64_EOCD = b"PK\x06\x06"
SIG_Z64_LOC = b"PK\x06\x07"
U32 = 0xFFFFFFFF
U16 = 0xFFFF
TAIL_BYTES = 65536 + 22 + 20 + 56  # comentário máx + EOCD + locator + zip64 EOCD


class ZipFormatError(RuntimeError):
    """Estrutura ZIP inválida, ou CRC/tamanho divergente."""


@dataclass(frozen=True)
class ZipEntry:
    """Entrada do diretório central."""

    name: str
    method: int
    flags: int
    crc32: int
    csize: int
    usize: int
    offset: int  # offset do local file header
    cd_extra_len: int


def _parse_eocd(buf: bytes, buf_start: int) -> tuple[int, int, int]:
    """Devolve (cd_offset, cd_size, n_entries) a partir de um buffer que contém o fim do zip.

    buf_start é o offset absoluto de buf[0] dentro do zip.
    """
    i = buf.rfind(SIG_EOCD)
    if i < 0:
        raise ZipFormatError("EOCD não encontrado")
    _, _, _, n_disk, n_total, cd_size, cd_off, _ = struct.unpack("<4sHHHHIIH", buf[i : i + 22])
    if cd_off != U32 and cd_size != U32 and n_total != U16:
        return cd_off, cd_size, n_total
    j = i - 20
    if j < 0 or buf[j : j + 4] != SIG_Z64_LOC:
        raise ZipFormatError("zip64 locator não encontrado")
    (z64_abs,) = struct.unpack("<Q", buf[j + 8 : j + 16])
    k = z64_abs - buf_start
    if k < 0 or buf[k : k + 4] != SIG_Z64_EOCD:
        raise ZipFormatError("zip64 EOCD fora do buffer")
    n_total, cd_size, cd_off = struct.unpack("<QQQ", buf[k + 32 : k + 56])
    return cd_off, cd_size, n_total


def _parse_central_directory(cd: bytes, n_expected: int) -> list[ZipEntry]:
    entries: list[ZipEntry] = []
    i = 0
    while i + 46 <= len(cd) and cd[i : i + 4] == SIG_CDH:
        (_, _, flags, method, _, _, crc, csize, usize, nl, el, cl, _, _, _, off) = struct.unpack(
            "<HHHHHHIIIHHHHHII", cd[i + 4 : i + 46]
        )
        raw_name = cd[i + 46 : i + 46 + nl]
        name = raw_name.decode("utf-8" if flags & 0x800 else "cp437")
        extra = cd[i + 46 + nl : i + 46 + nl + el]
        if U32 in (csize, usize, off):
            usize, csize, off = _apply_zip64_extra(extra, usize, csize, off)
        entries.append(ZipEntry(name, method, flags, crc, csize, usize, off, el))
        i += 46 + nl + el + cl
    if len(entries) != n_expected:
        raise ZipFormatError(f"diretório central: {len(entries)} entradas, esperado {n_expected}")
    return entries


def _apply_zip64_extra(extra: bytes, usize: int, csize: int, off: int) -> tuple[int, int, int]:
    """Substitui campos 0xFFFFFFFF pelos valores do extra zip64 (id 0x0001), na ordem da APPNOTE."""
    p = 0
    while p + 4 <= len(extra):
        hid, size = struct.unpack("<HH", extra[p : p + 4])
        body = extra[p + 4 : p + 4 + size]
        if hid == 0x0001:
            vals = list(struct.unpack(f"<{len(body) // 8}Q", body[: len(body) // 8 * 8]))
            if usize == U32:
                usize = vals.pop(0)
            if csize == U32:
                csize = vals.pop(0)
            if off == U32:
                off = vals.pop(0)
            return usize, csize, off
        p += 4 + size
    raise ZipFormatError("campo zip64 ausente")


def inflate_member(entry: ZipEntry, local: bytes) -> bytes:
    """Recebe bytes a partir do local file header e devolve o conteúdo verificado (CRC e tamanho)."""
    if local[:4] != SIG_LFH:
        raise ZipFormatError(f"{entry.name}: local file header inválido")
    if entry.flags & 0x1:
        raise ZipFormatError(f"{entry.name}: membro cifrado")
    nl, el = struct.unpack("<HH", local[26:30])
    start = 30 + nl + el
    comp = local[start : start + entry.csize]
    if len(comp) != entry.csize:
        raise ZipFormatError(f"{entry.name}: dados truncados")
    if entry.method == 8:
        data = zlib.decompress(comp, -15)
    elif entry.method == 0:
        data = comp
    else:
        raise ZipFormatError(f"{entry.name}: método {entry.method} não suportado")
    if len(data) != entry.usize or zlib.crc32(data) != entry.crc32:
        raise ZipFormatError(f"{entry.name}: CRC32/tamanho divergente")
    return data


class RemoteZip:
    """ZIP remoto acessado por Range, com cache do diretório central em disco.

    O cache é `<cache_dir>/<nome do zip>.cd` (bytes do zip de cd_offset até o fim) + `.cd.json`
    (metadados: tamanho total, cd_offset, etag...). Um .cd pré-existente sem metadados é aceito
    se `cd_offset + tamanho do .cd == tamanho remoto`.
    """

    def __init__(self, url: str, client: HttpClient, cache_dir: Path, refresh: bool = False) -> None:
        self.url = url
        self.client = client
        name = url.rsplit("/", 1)[-1]
        self.cd_path = cache_dir / f"{name}.cd"
        self.meta_path = cache_dir / f"{name}.cd.json"
        self.entries = self._load(refresh)
        self.by_name = {e.name: e for e in self.entries}

    def _load(self, refresh: bool) -> list[ZipEntry]:
        if not refresh and self.cd_path.exists() and self.meta_path.exists():
            meta = json.loads(self.meta_path.read_text())
            tail = self.cd_path.read_bytes()
            if len(tail) == meta["size"] - meta["cd_offset"]:
                return self._entries_from_tail(tail, meta["cd_offset"])
        head = self.client.head(self.url)
        size = int(head.headers["Content-Length"])
        if not refresh and self.cd_path.exists():
            tail = self.cd_path.read_bytes()
            try:
                cd_off, _, _ = _parse_eocd(tail, size - len(tail))
            except ZipFormatError:
                cd_off = -1
            if cd_off == size - len(tail):
                self._write_meta(head, size, cd_off)
                return self._entries_from_tail(tail, cd_off)
        end = self.client.get_range(self.url, max(0, size - TAIL_BYTES), size - 1)
        cd_off, _, _ = _parse_eocd(end, max(0, size - TAIL_BYTES))
        tail = self.client.get_range(self.url, cd_off, size - 1)
        self.cd_path.parent.mkdir(parents=True, exist_ok=True)
        part = self.cd_path.with_name(self.cd_path.name + ".part")
        part.write_bytes(tail)
        part.replace(self.cd_path)
        self._write_meta(head, size, cd_off)
        return self._entries_from_tail(tail, cd_off)

    def _write_meta(self, head, size: int, cd_off: int) -> None:
        meta = {
            "url": self.url,
            "size": size,
            "cd_offset": cd_off,
            "etag": head.headers.get("ETag"),
            "last_modified": head.headers.get("Last-Modified"),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        self.meta_path.write_text(json.dumps(meta, indent=2))

    def _entries_from_tail(self, tail: bytes, cd_off: int) -> list[ZipEntry]:
        self.cd_offset = cd_off
        _, cd_size, n = _parse_eocd(tail, cd_off)
        return _parse_central_directory(tail[:cd_size], n)

    def read_members(self, entries: Iterable[ZipEntry], max_gap: int = 1 << 15) -> Iterator[tuple[ZipEntry, bytes]]:
        """Baixa e infla membros. Membros vizinhos no zip são agrupados num único Range."""
        ordered = sorted(entries, key=lambda e: e.offset)
        groups: list[list[ZipEntry]] = []
        for e in ordered:
            if groups and e.offset - self._end_estimate(groups[-1][-1]) <= max_gap:
                groups[-1].append(e)
            else:
                groups.append([e])
        for group in groups:
            start = group[0].offset
            end = min(self._end_estimate(group[-1]), self.cd_offset)
            blob = self.client.get_range(self.url, start, end - 1)
            for e in group:
                local = blob[e.offset - start :]
                try:
                    yield e, inflate_member(e, local)
                except ZipFormatError as exc:
                    if "truncados" not in str(exc):
                        raise
                    nl, el = struct.unpack("<HH", local[26:30])  # extra local maior que o estimado
                    full = self.client.get_range(self.url, e.offset, e.offset + 30 + nl + el + e.csize - 1)
                    yield e, inflate_member(e, full)

    @staticmethod
    def _end_estimate(e: ZipEntry) -> int:
        """Fim provável do membro (header local estimado pelo extra do diretório central + folga)."""
        return e.offset + 30 + len(e.name.encode()) + e.cd_extra_len + 64 + e.csize


def fim_membro(e: ZipEntry) -> int:
    """Offset (exclusivo) do fim provável do membro: header local estimado pelo extra do diretório
    central (+64 B de folga para um extra local maior) + dados comprimidos. Igual a
    ``RemoteZip._end_estimate``."""
    return e.offset + 30 + len(e.name.encode()) + e.cd_extra_len + 64 + e.csize


class TrechoLocal:
    """Um trecho contíguo do zip (bytes ``[inicio, inicio + tamanho)``) salvo num arquivo local, por
    exemplo um bloco baixado por ``HttpClient.download_range``. ``read_members`` infla os membros que
    cabem no trecho, conferindo CRC32 e tamanho (``inflate_member``)."""

    def __init__(self, path: Path, inicio: int) -> None:
        self.path = Path(path)
        self.inicio = inicio
        self.tamanho = self.path.stat().st_size

    def contem(self, e: ZipEntry) -> bool:
        return e.offset >= self.inicio and e.offset + 30 <= self.inicio + self.tamanho

    def read_members(self, entries: Iterable[ZipEntry]) -> Iterator[tuple[ZipEntry, bytes]]:
        with open(self.path, "rb") as fh:
            for e in sorted(entries, key=lambda x: x.offset):
                if not self.contem(e):
                    raise ZipFormatError(f"{e.name}: fora do trecho [{self.inicio}, {self.inicio + self.tamanho})")
                fh.seek(e.offset - self.inicio)
                head = fh.read(30)
                if len(head) < 30:
                    raise ZipFormatError(f"{e.name}: local file header truncado")
                nl, el = struct.unpack("<HH", head[26:30])
                yield e, inflate_member(e, head + fh.read(nl + el + e.csize))


class LocalZip:
    """O mesmo zip, lido de um arquivo local (zip inteiro já baixado), com a mesma interface de
    ``RemoteZip`` (``entries``, ``by_name``, ``cd_offset``, ``read_members``).

    Não usa ``zipfile``: o diretório central é lido pelo mesmo código do ``RemoteZip`` (zip64
    incluso) e cada membro é inflado por ``inflate_member``, que confere CRC32 e tamanho.
    ``tail_bytes()`` devolve os bytes de ``cd_offset`` até o fim, para comparar com o cache
    ``.cd`` do ``RemoteZip`` (mesmo diretório central = mesmo zip publicado).
    """

    def __init__(self, path: Path, url: str | None = None) -> None:
        self.path = Path(path)
        self.url = url or self.path.as_uri()
        self.size = self.path.stat().st_size
        with open(self.path, "rb") as fh:
            start = max(0, self.size - TAIL_BYTES)
            fh.seek(start)
            end = fh.read()
            cd_off, _, _ = _parse_eocd(end, start)
            fh.seek(cd_off)
            tail = fh.read()
        self.cd_offset = cd_off
        _, cd_size, n = _parse_eocd(tail, cd_off)
        self.entries = _parse_central_directory(tail[:cd_size], n)
        self.by_name = {e.name: e for e in self.entries}

    def tail_bytes(self) -> bytes:
        with open(self.path, "rb") as fh:
            fh.seek(self.cd_offset)
            return fh.read()

    def read_members(self, entries: Iterable[ZipEntry], max_gap: int = 0) -> Iterator[tuple[ZipEntry, bytes]]:
        """Lê e infla membros em ordem de offset (``max_gap`` ignorado; existe por compatibilidade)."""
        with open(self.path, "rb") as fh:
            for e in sorted(entries, key=lambda x: x.offset):
                fh.seek(e.offset)
                head = fh.read(30)
                if len(head) < 30:
                    raise ZipFormatError(f"{e.name}: local file header truncado")
                nl, el = struct.unpack("<HH", head[26:30])
                yield e, inflate_member(e, head + fh.read(nl + el + e.csize))
