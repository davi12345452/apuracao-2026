"""Parsers do portal do TSE e do BU, com arquivos reais capturados em 25/10/2026."""

import json
from pathlib import Path

from analise_urnas.parsers.bu import parse_bu

from apuracao import tse
from apuracao.exterior import escolher_hash

FIX = Path(__file__).parent / "fixtures"


def carregar(nome):
    return json.loads((FIX / nome).read_text(encoding="utf-8"))


def test_parse_u_municipio_1t():
    p = tse.parse_u(carregar("zz30627-c0001-e006257-u.json"))
    assert p["abr"] == "30627"
    assert (p["ts"], p["st"]) == (43, 43)
    assert (p["te"], p["c"], p["a"]) == (30028, 13392, 16636)
    assert p["vv"] == 12400
    assert (p["lula"], p["flavio"]) == (2328, 8423)
    assert p["vb"] == 642 and p["vn"] == 350
    assert sum(p["cand"].values()) == p["vv"]


def test_parse_u_br_antes_da_apuracao():
    p = tse.parse_u(carregar("br-c0001-e006258-u.json"))
    assert p["st"] == 0 and p["vv"] == 0
    assert p["te"] == 158745502
    assert set(p["cand"]) == {tse.LULA, tse.FLAVIO}


def test_parse_ab():
    ab = tse.parse_ab(carregar("zz-e006258-ab.json"))
    assert len(ab) == 5
    assert ab[0]["mun"] == "29173" and ab[0]["ts"] == 1 and ab[0]["te"] == 32


def test_secoes_cs_sem_agregadas():
    secs = tse.secoes_cs(carregar("zz-p003221-cs.json"))
    assert len(secs) == 1351  # = "ts" do zz-c0001-e006258-u.json
    budapeste = [s for s in secs if s[0] == "29459"]
    assert [s[3] for s in budapeste] == ["1695", "1696"]  # 3124 é agregada a 1695


def test_bu_toquio():
    r = tse.resumo_bu(parse_bu((FIX / "o03221zz3062700011389-bu.dat").read_bytes()))
    assert r["aptos"] == 717 and r["comparecimento"] == 315
    assert (r["lula"], r["flavio"], r["brancos"], r["nulos"]) == (91, 211, 8, 5)
    assert r["lula"] + r["flavio"] + r["brancos"] + r["nulos"] == r["comparecimento"]


def test_escolher_hash_prefere_totalizado():
    aux = carregar("p003221-zz-m30627-z0001-s1389-aux.json")
    assert escolher_hash(aux)["st"] == "Recebido"
    aux["hashes"].insert(0, {"hash": "x", "st": "Totalizado", "arq": []})
    assert escolher_hash(aux)["hash"] == "x"
    assert escolher_hash({"hashes": []}) is None


def test_urls():
    assert tse.url_u("br").endswith("/ele2026/6258/dados/br/br-c0001-e006258-u.json")
    assert tse.url_u("sp", tse.ELE_1T, "71072").endswith("/6257/dados/sp/sp71072-c0001-e006257-u.json")
    assert tse.url_aux("zz", "30627", "0001", "1389").endswith(
        "/arquivo-urna/3221/dados/zz/30627/0001/1389/p003221-zz-m30627-z0001-s1389-aux.json")
