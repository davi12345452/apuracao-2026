"""Comparação 2022 × 1º turno × agora por estado (apuracao.comparacao)."""

import numpy as np
import pytest

from apuracao import comparacao, tse
from apuracao.db import DB
from apuracao.painel import Ctx

I = {k: i for i, k in enumerate(comparacao.VETOR)}
INS_BASE = "INSERT INTO base VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
INS_HIST = ("INSERT INTO mun_hist (ts_coleta, uf, mun, dg, hg, secoes_tot, secoes_apur, eleitorado, eleitorado_apur, "
            "comparecimento, abstencao, validos, brancos, nulos, lula, flavio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
INS_MUN = ("INSERT OR REPLACE INTO mun (uf, mun, dg, hg, secoes_tot, secoes_apur, eleitorado, eleitorado_apur, "
           "comparecimento, abstencao, validos, brancos, nulos, lula, flavio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")


@pytest.fixture()
def db(tmp_path):
    comparacao._CACHE.update(chave=None, serie=[])
    d = DB(tmp_path / "t.db")
    # (fonte, uf, mun, aptos, comparecimento, abstencao, validos, brancos, nulos, lula, direita, outros)
    d.executemany(INS_BASE, [
        ("2026_1t", "sp", "1", 1000, 800, 200, 700, 50, 50, 300, 300, 100),
        ("2026_1t", "sp", "2", 2000, 1600, 400, 1500, 50, 50, 500, 800, 200),
        ("2026_1t", "ba", "3", 1000, 800, 200, 760, 20, 20, 500, 200, 60),
        ("2026_1t", "zz", "9", 100, 50, 50, 48, 1, 1, 30, 15, 3),
        ("2022_2t", "sp", "1", 900, 700, 200, 680, 10, 10, 320, 360, 0),
        ("2022_2t", "sp", "2", 1800, 1500, 300, 1440, 30, 30, 600, 840, 0),
        ("2022_2t", "ba", "3", 950, 760, 190, 740, 10, 10, 560, 180, 0),
        ("2022_2t", "zz", "9", 90, 40, 50, 40, 0, 0, 26, 14, 0),
    ])
    return d


def _ler(d, uf, mun, est, comp, lula, flavio, hg, te=1000):
    d.execute(INS_HIST, ("2026-10-25T20:00:00", uf, mun, "25/10/2026", hg, 10, est // 100, te, est, comp, est - comp,
                         lula + flavio, 0, 0, lula, flavio))
    d.execute(INS_MUN, (uf, mun, "25/10/2026", hg, 10, est // 100, te, est, comp, est - comp, lula + flavio, 0, 0, lula, flavio))


def _montar(d):
    ctx = Ctx(d)
    return comparacao.montar(ctx, ctx.unidades("2026_1t"))


def test_sem_apuracao_tem_referencias_completas(db):
    c = _montar(db)
    sp, ba = c["ufs"].index("sp"), c["ufs"].index("ba")
    assert c["eleitorado"][sp] == 3000 and c["eleitorado"][ba] == 1000
    assert all(v == 0 for v in c["agora"][sp]) and c["serie"] == []
    assert c["final_2022"][sp] == [920, 1200, 2200, 2700]
    assert c["final_1t"][ba] == [500, 200, 60, 800, 1000]
    assert len(c["regiao"]) == len(c["ufs"]) == len(tse.UFS) + 1


def test_mesmas_urnas_na_fracao_apurada(db):
    _ler(db, "sp", "1", 500, 400, 200, 180, "17:10:00")  # metade do município 1
    c = _montar(db)
    v = c["agora"][c["ufs"].index("sp")]
    assert v[I["est"]] == 500 and v[I["lula"]] == 200 and v[I["flavio"]] == 180 and v[I["comp"]] == 400
    # 2022 e 1º turno: metade do município 1, nada do município 2
    assert v[I["l22"]] == 160 and v[I["b22"]] == 180 and v[I["c22"]] == 350 and v[I["a22"]] == 450
    assert v[I["l1"]] == 150 and v[I["f1"]] == 150 and v[I["o1"]] == 50 and v[I["c1"]] == 400


def test_serie_por_minuto_so_com_estados_que_mudaram(db):
    _ler(db, "sp", "1", 500, 400, 200, 180, "17:10:00")
    _ler(db, "ba", "3", 1000, 800, 520, 230, "17:12:30")
    _ler(db, "sp", "1", 1000, 800, 400, 360, "17:20:05")
    c = _montar(db)
    sp, ba = c["ufs"].index("sp"), c["ufs"].index("ba")
    assert [p[0] for p in c["serie"]] == ["17:10", "17:12", "17:20"]
    assert [ln[0] for ln in c["serie"][1][1]] == [ba]  # no 2º ponto só a Bahia mudou
    ult = {ln[0]: ln[1:] for p in c["serie"] for ln in p[1]}
    campos = c["campos_serie"]
    assert dict(zip(campos, ult[sp]))["est"] == 1000 and dict(zip(campos, ult[sp]))["l22"] == 320
    # o último ponto da curva bate com o "agora" (mesmos campos)
    assert ult[sp] == [c["agora"][sp][comparacao.VETOR.index(k)] for k in campos]
    assert ult[ba] == [c["agora"][ba][comparacao.VETOR.index(k)] for k in campos]


def test_exterior_usa_bu_ou_totalizacao_o_que_cobre_mais(db):
    db.executemany("INSERT INTO bu (mun, zona, secao, recebido_tse, baixado_em, aptos, comparecimento, lula, flavio, "
                   "brancos, nulos, encerramento, emissao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        ("9", "1", "1", "25/10/2026 09:00:00", "", 40, 20, 12, 7, 1, 0, "", ""),
        ("9", "1", "2", "25/10/2026 11:30:00", "", 30, 15, 9, 6, 0, 0, "", ""),
    ])
    c = _montar(db)
    zz = c["ufs"].index("zz")
    assert c["agora"][zz][I["est"]] == 70 and c["agora"][zz][I["lula"]] == 21
    assert [p[0] for p in c["serie"]] == ["09:00", "11:30"]
    assert c["agora"][zz][I["l22"]] == round(26 * 0.7)


def test_agregacao_e_soma_dos_estados(db):
    """O navegador soma estados: a soma dos vetores tem de dar o mesmo que o Brasil inteiro."""
    _ler(db, "sp", "2", 1000, 800, 260, 500, "17:10:00", te=2000)
    _ler(db, "ba", "3", 400, 330, 200, 110, "17:11:00")
    c = _montar(db)
    A = np.array(c["agora"])
    tot = A.sum(0)
    assert tot[I["est"]] == 1400 and tot[I["lula"]] == 460 and tot[I["flavio"]] == 610
    assert tot[I["l1"]] == 250 + 200 and tot[I["b22"]] == 420 + 72
