"""SQLite local: série temporal da apuração, BUs do exterior, municípios e bases de comparação."""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(os.environ.get("APURACAO_DB", Path(__file__).resolve().parents[2] / "data" / "apuracao.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS snap (            -- série temporal de br, zz e UFs (arquivos -u)
    ts_coleta TEXT NOT NULL,
    abr TEXT NOT NULL,
    dg TEXT, hg TEXT,
    secoes_tot INTEGER, secoes_apur INTEGER,
    eleitorado INTEGER, eleitorado_apur INTEGER, comparecimento INTEGER, abstencao INTEGER,
    validos INTEGER, brancos INTEGER, nulos INTEGER, lula INTEGER, flavio INTEGER,
    PRIMARY KEY (abr, dg, hg)
);
CREATE TABLE IF NOT EXISTS mun (             -- último estado de cada município (arquivo -u do município)
    uf TEXT NOT NULL, mun TEXT NOT NULL,
    dg TEXT, hg TEXT,
    secoes_tot INTEGER, secoes_apur INTEGER,
    eleitorado INTEGER, eleitorado_apur INTEGER, comparecimento INTEGER, abstencao INTEGER,
    validos INTEGER, brancos INTEGER, nulos INTEGER, lula INTEGER, flavio INTEGER,
    PRIMARY KEY (uf, mun)
);
CREATE TABLE IF NOT EXISTS mun_ab (          -- arquivo -ab: avanço por município (sem votos)
    uf TEXT NOT NULL, mun TEXT NOT NULL,
    secoes_tot INTEGER, secoes_apur INTEGER,
    eleitorado INTEGER, eleitorado_apur INTEGER, comparecimento INTEGER, abstencao INTEGER,
    PRIMARY KEY (uf, mun)
);
CREATE TABLE IF NOT EXISTS secao_ext (       -- seções do exterior com arquivo próprio
    mun TEXT NOT NULL, zona TEXT NOT NULL, secao TEXT NOT NULL,
    cidade TEXT,
    status TEXT NOT NULL DEFAULT 'pendente', -- pendente | ok | erro
    tentativas INTEGER NOT NULL DEFAULT 0,
    ultima_consulta TEXT,
    PRIMARY KEY (mun, zona, secao)
);
CREATE TABLE IF NOT EXISTS bu (              -- BUs do 2º turno no exterior, já decodificados
    mun TEXT NOT NULL, zona TEXT NOT NULL, secao TEXT NOT NULL,
    recebido_tse TEXT, baixado_em TEXT,
    aptos INTEGER, comparecimento INTEGER,
    lula INTEGER, flavio INTEGER, brancos INTEGER, nulos INTEGER,
    encerramento TEXT, emissao TEXT,
    PRIMARY KEY (mun, zona, secao)
);
CREATE TABLE IF NOT EXISTS base (            -- resultado final de eleições anteriores por município
    fonte TEXT NOT NULL,                     -- 2026_1t | 2022_1t | 2022_2t
    uf TEXT NOT NULL, mun TEXT NOT NULL,
    aptos INTEGER, comparecimento INTEGER, abstencao INTEGER,
    validos INTEGER, brancos INTEGER, nulos INTEGER,
    lula INTEGER, direita INTEGER,           -- direita: Flávio (2026) ou Bolsonaro (2022)
    outros INTEGER,
    PRIMARY KEY (fonte, uf, mun)
);
CREATE TABLE IF NOT EXISTS municipio (       -- cadastro (cm.json) + país das cidades do exterior
    uf TEXT NOT NULL, mun TEXT NOT NULL, nome TEXT, ibge TEXT, pais TEXT, iso3 TEXT,
    PRIMARY KEY (uf, mun)
);
CREATE TABLE IF NOT EXISTS saude (          -- batimentos dos laços e estado do vigia
    chave TEXT PRIMARY KEY, valor TEXT, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mercado (         -- cotações de Polymarket e Kalshi ao longo do tempo
    ts TEXT NOT NULL, fonte TEXT NOT NULL, dados TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proj_hist (       -- projeções ao longo da noite (para o gráfico de convergência)
    ts TEXT NOT NULL, escopo TEXT NOT NULL, apurado REAL, parcial REAL,
    modelo TEXT NOT NULL, p50 REAL, p10 REAL, p90 REAL, prob REAL,
    PRIMARY KEY (escopo, modelo, ts)
);
CREATE TABLE IF NOT EXISTS evento (
    ts TEXT NOT NULL, nivel TEXT NOT NULL, msg TEXT NOT NULL
);
"""


class DB:
    """Uma conexão compartilhada entre threads, serializada por lock (o volume é pequeno)."""

    def __init__(self, path: Path | str = DB_PATH) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(SCHEMA)
        self.lock = threading.Lock()

    def execute(self, sql: str, params=()) -> sqlite3.Cursor:
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur

    def executemany(self, sql: str, rows) -> None:
        with self.lock:
            self.conn.executemany(sql, rows)
            self.conn.commit()

    def query(self, sql: str, params=()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params=()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def batida(self, chave: str, valor: str = "ok") -> None:
        from datetime import datetime

        self.execute("INSERT OR REPLACE INTO saude VALUES (?,?,?)", (chave, valor, datetime.now().isoformat(timespec="seconds")))

    def log(self, nivel: str, msg: str) -> None:
        from datetime import datetime

        self.execute("INSERT INTO evento VALUES (?,?,?)", (datetime.now().isoformat(timespec="seconds"), nivel, msg))
