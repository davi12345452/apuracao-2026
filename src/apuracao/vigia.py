"""Vigia: supervisiona coletor e servidor, confere a coleta e avisa por notificação do macOS.

- reinicia coletor/servidor se caírem;
- alerta se um laço parar de bater (oficial > 3 min, exterior > 15 min, mercados > 10 min);
- depois das 17h, confere o br do painel contra o arquivo do TSE e contra o ascaribe;
- avisa marcos: chegada de BUs, início da totalização, 25/50/75/90/99% apurado, projeção definida.

Uso: python -m apuracao.vigia   (é o que ./run.sh start liga)
"""

from __future__ import annotations

import json
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

from . import tse
from .db import DB

RAIZ = Path(__file__).resolve().parents[2]
PY = sys.executable
PROCS = {"coletor": [PY, "-m", "apuracao.coletor"], "server": [PY, "-m", "apuracao.server"]}
LIMITES = {"oficial": 180, "exterior": 900, "mercados": 600}
ASCARIBE = "https://dados.ascaribe.tech/real/nacional.json"


def notificar(titulo: str, msg: str) -> None:
    msg = msg.replace('"', "'")
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "{titulo}" sound name "Glass"'],
                   capture_output=True, timeout=10)


def _idade(ts: str | None) -> float:
    if not ts:
        return 1e9
    return (datetime.now() - datetime.fromisoformat(ts)).total_seconds()


class Vigia:
    def __init__(self, db: DB) -> None:
        self.db = db
        self.filhos: dict[str, subprocess.Popen] = {}
        self.reinicios: dict[str, int] = {k: 0 for k in PROCS}
        self.marcos: set[str] = set(json.loads((self.db.one("SELECT valor FROM saude WHERE chave='vigia_marcos'") or {}).get("valor") or "[]"))
        self.alertas_ativos: dict[str, float] = {}
        self.ultimo_cruzamento = 0.0
        self.subiu_em: dict[str, float] = {}

    # ---------- processos ----------
    def subir(self, nome: str) -> None:
        log = open(RAIZ / "data" / f"{nome}.log", "a")
        self.subiu_em[nome] = time.monotonic()
        self.filhos[nome] = subprocess.Popen(["nice", "-n", "10", *PROCS[nome]], cwd=RAIZ, stdout=log, stderr=log)

    def supervisionar(self) -> None:
        for nome in PROCS:
            p = self.filhos.get(nome)
            if p is None or p.poll() is not None:
                if p is not None:
                    self.reinicios[nome] += 1
                    self.db.log("erro", f"vigia: {nome} caiu (código {p.returncode}); reiniciando")
                    notificar("Apuração · vigia", f"{nome} caiu e foi reiniciado")
                self.subir(nome)

    def encerrar(self, *_):
        for p in self.filhos.values():
            p.terminate()
        sys.exit(0)

    # ---------- checagens ----------
    def alerta(self, chave: str, msg: str) -> None:
        """Registra e notifica, no máximo uma vez a cada 10 min por chave."""
        if time.monotonic() - self.alertas_ativos.get(chave, -1e9) > 600:
            self.alertas_ativos[chave] = time.monotonic()
            self.db.log("erro", f"vigia: {msg}")
            notificar("Apuração · alerta", msg)

    def marco(self, chave: str, msg: str) -> None:
        if chave not in self.marcos:
            self.marcos.add(chave)
            self.db.log("info", f"vigia: {msg}")
            self.db.batida("vigia_marcos", json.dumps(sorted(self.marcos)))
            notificar("Apuração", msg)

    def checar(self) -> list[tuple[str, str]]:
        problemas: list[tuple[str, str]] = []
        saude = {r["chave"]: r for r in self.db.query("SELECT * FROM saude")}
        desde_subida = time.monotonic() - self.subiu_em.get("coletor", 0)
        for laco, lim in LIMITES.items():
            idade = min(_idade((saude.get(laco) or {}).get("ts")), desde_subida)
            exterior_acabou = laco == "exterior" and self.db.one("SELECT count(*) n FROM secao_ext WHERE status!='ok'")["n"] == 0
            if idade > lim and not exterior_acabou:
                problemas.append((f"laco_{laco}", f"laço {laco} sem batida há {int(idade)} s"))
        n_bu = self.db.one("SELECT count(*) n FROM bu")["n"]
        for m in (200, 400, 600, 800, 1000, 1200, 1351):
            if n_bu >= m:
                self.marco(f"bu{m}", f"exterior: {n_bu} de 1.351 seções com boletim")
        br = self.db.one("SELECT * FROM snap WHERE abr='br' ORDER BY ts_coleta DESC LIMIT 1")
        if br and br["secoes_apur"]:
            pct = 100 * br["secoes_apur"] / br["secoes_tot"]
            self.marco("inicio", f"TSE começou a totalizar: {pct:.2f}% apurado")
            for m in (25, 50, 75, 90, 99):
                if pct >= m:
                    lula = 100 * br["lula"] / max(br["validos"], 1)
                    self.marco(f"ap{m}", f"{pct:.1f}% apurado · Lula {lula:.2f}% × Flávio {100 - lula:.2f}%")
            problemas += self.cruzar(br)
        for r in self.db.query("SELECT * FROM proj_hist WHERE escopo='br' AND ts=(SELECT max(ts) FROM proj_hist WHERE escopo='br')"):
            if r["apurado"] and r["apurado"] >= 5 and r["p10"] and r["p90"]:
                if r["p10"] > 50:
                    self.marco(f"def_lula_{r['modelo']}", f"projeção {r['modelo']}: faixa de 80% toda acima de 50% para Lula ({r['p50']:.2f}%)")
                elif r["p90"] < 50:
                    self.marco(f"def_flavio_{r['modelo']}", f"projeção {r['modelo']}: faixa de 80% toda abaixo de 50% para Lula ({r['p50']:.2f}%)")
        return problemas

    def cruzar(self, br: dict) -> list[tuple[str, str]]:
        """A cada 2 min: nosso br contra o arquivo do TSE e contra o ascaribe."""
        if time.monotonic() - self.ultimo_cruzamento < 120:
            return []
        self.ultimo_cruzamento = time.monotonic()
        out = []
        try:
            p = tse.parse_u(requests.get(tse.url_u("br"), timeout=15).json())
            if p["hg"] != br["hg"] and _idade(br["ts_coleta"]) > 120:
                out.append(("tse_atraso", f"painel com br de {br['hg']} e TSE já em {p['hg']}"))
            elif p["hg"] == br["hg"] and (p["lula"], p["flavio"]) != (br["lula"], br["flavio"]):
                out.append(("tse_difere", "br do painel difere do TSE no mesmo horário"))
        except Exception as e:  # noqa: BLE001
            out.append(("tse_falha", f"falha ao ler o TSE: {e!r}"))
        try:
            a = requests.get(ASCARIBE, timeout=15).json()
            cand = {c["nome"]: c["votos"] for c in a.get("candidatos", [])}
            if a.get("apurado_pct") and abs(a["apurado_pct"] - 100 * br["secoes_apur"] / br["secoes_tot"]) < 0.5:
                l_a = 100 * cand.get("LULA", 0) / max(cand.get("LULA", 0) + cand.get("FLAVIO BOLSONARO", 0), 1)
                l_n = 100 * br["lula"] / max(br["validos"], 1)
                self.db.batida("cruzamento_ascaribe", json.dumps({"nosso": round(l_n, 3), "ascaribe": round(l_a, 3)}))
                if abs(l_a - l_n) > 0.3:
                    out.append(("ascaribe", f"Lula {l_n:.2f}% aqui × {l_a:.2f}% no ascaribe com o mesmo apurado"))
        except Exception:  # noqa: BLE001 - o ascaribe é só referência
            pass
        return out

    def rodar(self) -> None:
        signal.signal(signal.SIGTERM, self.encerrar)
        signal.signal(signal.SIGINT, self.encerrar)
        self.db.log("info", "vigia iniciado")
        while True:
            self.supervisionar()
            try:
                problemas = self.checar()
            except Exception as e:  # noqa: BLE001
                problemas = [("checagem", f"checagem falhou: {e!r}")]
            for chave, msg in problemas:
                self.alerta(chave, msg)
            self.db.batida("vigia", json.dumps({"status": "alerta" if problemas else "ok", "problemas": [m for _, m in problemas],
                                                "reinicios": self.reinicios}, ensure_ascii=False))
            time.sleep(30)


def main() -> None:
    Vigia(DB()).rodar()


if __name__ == "__main__":
    main()
