"""Parser do Boletim de Urna (``.bu`` em 2022, ``-bu.dat`` em 2026).

Specs: ``specs/bu.asn1`` (oficial TSE, 2022) e ``specs/2026/bu.asn1`` (reconstrução **não
oficial** para 2026, ver ``specs/2026/FONTE.md``). A versão é detectada pela string
``Urna.versaoVotacao`` do conteúdo (ver ``asn1.detectar_versao``) e pode ser forçada com
``versao=``.

Estrutura do arquivo: ``EntidadeEnvelopeGenerico`` (BER) cujo campo ``conteudo``
é um ``EntidadeBoletimUrna`` codificado em BER. O envelope não mudou entre 2022 e 2026.
"""

from __future__ import annotations

import hashlib
import os
from typing import Any

from . import asn1

#: Categorias de voto usadas nas totalizações (BU e RDV usam enums diferentes).
CATEGORIAS = ("nominal", "legenda", "branco", "nulo")


def _totais_cargo(votos: list[dict[str, Any]]) -> dict[str, Any]:
    """Totais por categoria a partir das tuplas de um cargo do BU."""
    nominal: dict[str, int] = {}
    legenda: dict[str, int] = {}
    partido: dict[str, int] = {}
    out: dict[str, Any] = {"branco": 0, "nulo": 0, "cargo_sem_candidato": 0}
    for v in votos:
        q = v["quantidade"]
        tipo = v["tipo_voto"]
        if tipo == "nominal":
            nominal[str(v["numero"])] = nominal.get(str(v["numero"]), 0) + q
        elif tipo == "legenda":
            legenda[str(v["partido"])] = legenda.get(str(v["partido"]), 0) + q
        elif tipo == "cargoSemCandidato":
            out["cargo_sem_candidato"] += q
        else:
            out[tipo] += q
        if tipo in ("nominal", "legenda"):
            partido[str(v["partido"])] = partido.get(str(v["partido"]), 0) + q
    out.update(
        nominal=nominal,
        legenda=legenda,
        partido=partido,
        total_nominal=sum(nominal.values()),
        total_legenda=sum(legenda.values()),
    )
    out["total_apurado"] = (
        out["total_nominal"] + out["total_legenda"] + out["branco"] + out["nulo"]
        + out["cargo_sem_candidato"]
    )
    return out


def decodificar_bu(
    path_or_bytes: str | os.PathLike[str] | bytes, versao: str | None = None
) -> tuple[dict, dict, str]:
    """Decodifica envelope e BU; devolve ``(envelope_sem_conteudo, bu, versao_spec)`` crus do asn1tools."""
    dados = asn1.ler_bytes(path_or_bytes)
    # O envelope é igual nas duas versões; a do conteúdo é detectada por versaoVotacao.
    envelope = asn1.compilar("bu", versao or "2022").decode("EntidadeEnvelopeGenerico", dados)
    conteudo = envelope.pop("conteudo")
    if envelope["tipoEnvelope"] != "envelopeBoletimUrna":
        raise ValueError(f"envelope não é de BU: {envelope['tipoEnvelope']}")
    bu, v = asn1.decodificar_versionado(
        lambda ver: asn1.compilar("bu", ver).decode("EntidadeBoletimUrna", conteudo),
        versao,
        asn1.detectar_versao(conteudo),
    )
    return envelope, bu, v


def _texto_hash_inicial(bu: dict[str, Any], id_eleicao: int) -> str:
    """Texto do 1º elo da cadeia de hashes (spec 2026, comentário de ``TotalVotosVotavel.hash``).

    ``idPleito(5)|idEleicao(5)|municipio(5)|zona(4)|secao(4)|codigoCarga(24)``. Município/zona/seção
    vêm da identificação da carga (como no script de exemplo do pacote); se a carga for de
    contingência (sem seção), usa-se ``identificacaoSecao`` do BU — **(observado)** é o que fecha
    a cadeia na única urna de contingência das amostras (SE 31011/0019/0126, ``contingenciaSecao``,
    carga de outro município); o script de exemplo do pacote não trata esse caso.
    """
    corr = bu["urna"]["correspondenciaResultado"]
    alt, ident = asn1.choice(corr["identificacao"])
    if alt != "identificacaoSecaoEleitoral":
        ident = bu["identificacaoSecao"]
    mz = ident["municipioZona"]
    _, pleito = asn1.choice(bu["cabecalho"]["idEleitoral"])
    return (
        f"{pleito:05}|{id_eleicao:05}|{mz['municipio']:05}|{mz['zona']:04}|"
        f"{ident['secao']:04}|{corr['carga']['codigoCarga']:24}"
    )


def _sha512_hex(texto: str) -> str:
    return hashlib.sha512(texto.encode("iso-8859-1")).hexdigest().upper()


def verificar_cadeia_hash(bu: dict[str, Any], versao: str = "2026") -> dict[int, dict[str, Any]]:
    """Recalcula a cadeia de hashes das tuplas do BU de 2026 (não verifica a assinatura ECDSA/EdDSA).

    ``bu`` é o dict cru de ``decodificar_bu``. Para cada eleição: hash inicial do cabeçalho,
    depois, para cada tupla em ordem, ``SHA-512("<hash anterior em HEX maiúsculo>|ordem|codigoCargo|
    tipoVoto|quantidadeVotos[|codigo|partido]")``; ``ordem`` recomeça em 1 a cada cargo e deve
    ser igual a ``ordemGeracaoHash``. O último hash deve ser ``ultimoHashVotosVotavel``.
    Devolve ``{id_eleicao: {tuplas, hashes_ok, ordem_ok, ultimo_hash_ok}}``.
    """
    tipos = asn1.enums("bu", versao)["TipoVoto"]
    out: dict[int, dict[str, Any]] = {}
    for eleicao in bu["resultadosVotacaoPorEleicao"]:
        h = _sha512_hex(_texto_hash_inicial(bu, eleicao["idEleicao"]))
        n = hashes_ok = ordem_ok = 0
        for res in eleicao["resultadosVotacao"]:
            for tvc in res["totaisVotosCargo"]:
                _, codigo_cargo = asn1.cargo(tvc["codigoCargo"], versao)
                for ordem, vv in enumerate(tvc["votosVotaveis"], start=1):
                    texto = f"{h}|{ordem}|{codigo_cargo}|{tipos[vv['tipoVoto']]}|{vv['quantidadeVotos']}"
                    ident = vv.get("identificacaoVotavel")
                    if ident:
                        texto += f"|{ident['codigo']}|{ident['partido']}"
                    h = _sha512_hex(texto)
                    n += 1
                    hashes_ok += h == vv["hash"].hex().upper()
                    ordem_ok += ordem == vv["ordemGeracaoHash"]
        out[eleicao["idEleicao"]] = {
            "tuplas": n,
            "hashes_ok": hashes_ok,
            "ordem_ok": ordem_ok,
            "ultimo_hash_ok": h == eleicao["ultimoHashVotosVotavel"].hex().upper(),
        }
    return out


def parse_bu(
    path_or_bytes: str | os.PathLike[str] | bytes, uf: str | None = None, versao: str | None = None
) -> dict[str, Any]:
    """Lê um BU e devolve um dict limpo e serializável em JSON.

    ``uf`` é opcional porque o BU não traz a UF (só o código TSE do município).
    ``versao`` força a spec ('2022' ou '2026'); por padrão é detectada (``versao_spec`` na saída).
    O dict decodificado completo fica em ``raw`` (bytes em hex, CHOICE como dict).

    Diferenças de saída em 2026 (chaves de 2022 mantidas):

    - ``qtd_eleitores_comp_biometrico`` = ``detalhamentoComparecimento.qtdEleitoresHabilitadosPorBiometria``;
    - ``qtd_eleitores_lib_codigo`` = ``detalhamentoComparecimento.qtdEleitoresHabilitadosPorBiografia``
      (habilitados por ano de nascimento; equivalência com o campo de 2022 é **inferida**: bate com
      o "habilitado manualmente pelo mesário" do LOG, não está escrita em nenhuma spec);
    - novos: ``qtd_eleitores_compareceram``, ``detalhamento_comparecimento``,
      ``historico_codigos_carga``, por eleição ``eleitores_aptos_secao``/``eleitores_aptos_tte``/
      ``ultimo_hash_votos_votavel``/``assinatura_ultimo_hash_votos_votavel``, por tupla
      ``ordem_geracao_hash``/``hash`` e ``cadeia_hash`` (recalculada, ver ``verificar_cadeia_hash``);
    - ``assinatura`` das tuplas e ``chave_assinatura_votos_votavel`` não existem mais (``None``);
      ``historico_correspondencias`` virou ``historico_codigos_carga`` (lista de códigos de carga).
    """
    envelope, bu, versao_spec = decodificar_bu(path_or_bytes, versao)
    v2026 = versao_spec != "2022"

    sec = bu["identificacaoSecao"]
    dados_alt, dados = asn1.choice(bu["dadosSecaoSA"])
    id_tipo, id_valor = asn1.choice(bu["cabecalho"]["idEleitoral"])

    eleicoes: list[dict[str, Any]] = []
    totais_por_cargo: dict[str, dict[str, Any]] = {}
    for eleicao in bu["resultadosVotacaoPorEleicao"]:
        resultados = []
        for res in eleicao["resultadosVotacao"]:
            cargos = []
            for tvc in res["totaisVotosCargo"]:
                nome_cargo, codigo_cargo = asn1.cargo(tvc["codigoCargo"], versao_spec)
                votos = []
                for vv in tvc["votosVotaveis"]:
                    ident = vv.get("identificacaoVotavel")
                    assinatura = vv.get("assinatura")
                    hash_tupla = vv.get("hash")
                    votos.append({
                        "tipo_voto": vv["tipoVoto"],
                        "partido": ident["partido"] if ident else None,
                        "numero": ident["codigo"] if ident else None,
                        "quantidade": vv["quantidadeVotos"],
                        "assinatura": assinatura.hex() if assinatura is not None else None,
                        "ordem_geracao_hash": vv.get("ordemGeracaoHash"),
                        "hash": hash_tupla.hex() if hash_tupla is not None else None,
                    })
                totais = _totais_cargo(votos)
                cargos.append({
                    "cargo": nome_cargo,
                    "codigo_cargo": codigo_cargo,
                    "ordem_impressao": tvc["ordemImpressao"],
                    "votos": votos,
                    "totais": totais,
                })
                chave = nome_cargo if nome_cargo not in totais_por_cargo else f"{nome_cargo}@{eleicao['idEleicao']}"
                totais_por_cargo[chave] = {
                    "id_eleicao": eleicao["idEleicao"],
                    "tipo_cargo": res["tipoCargo"],
                    "eleitores_aptos": eleicao["qtdEleitoresAptos"],
                    "comparecimento": res["qtdComparecimento"],
                    **totais,
                }
            resultados.append({
                "tipo_cargo": res["tipoCargo"],
                "comparecimento": res["qtdComparecimento"],
                "cargos": cargos,
            })
        ultimo_hash = eleicao.get("ultimoHashVotosVotavel")
        assinatura_ultimo = eleicao.get("assinaturaUltimoHashVotosVotavel")
        eleicoes.append({
            "id_eleicao": eleicao["idEleicao"],
            "eleitores_aptos": eleicao["qtdEleitoresAptos"],
            "eleitores_aptos_secao": eleicao.get("qtdEleitoresAptosSecao"),
            "eleitores_aptos_tte": eleicao.get("qtdEleitoresAptosTTE"),
            "ultimo_hash_votos_votavel": ultimo_hash.hex() if ultimo_hash is not None else None,
            "assinatura_ultimo_hash_votos_votavel": (
                assinatura_ultimo.hex() if assinatura_ultimo is not None else None
            ),
            "resultados": resultados,
        })

    aptos = max((e["eleitores_aptos"] for e in eleicoes), default=None)
    comparecimento = max(
        (r["comparecimento"] for e in eleicoes for r in e["resultados"]), default=None
    )

    detalhe = bu.get("detalhamentoComparecimento")
    detalhamento = {
        "sem_biometria": detalhe["qtdEleitoresCompareceramSemBiometria"],
        "habilitados_por_biometria": detalhe["qtdEleitoresHabilitadosPorBiometria"],
        "habilitados_por_biografia": detalhe["qtdEleitoresHabilitadosPorBiografia"],
    } if detalhe else None
    if v2026:
        lib_codigo = detalhamento["habilitados_por_biografia"] if detalhamento else None
        comp_bio = detalhamento["habilitados_por_biometria"] if detalhamento else None
    else:
        lib_codigo = bu.get("qtdEleitoresLibCodigo")
        comp_bio = bu.get("qtdEleitoresCompBiometrico")
    chave_assin = bu.get("chaveAssinaturaVotosVotavel")

    return {
        "versao_spec": versao_spec,
        "fase": bu["fase"],
        "id_eleitoral": {"tipo": id_tipo, "valor": id_valor},
        "data_geracao": asn1.data_hora_je(bu["cabecalho"]["dataGeracao"]),
        "envelope": {
            "tipo_envelope": envelope["tipoEnvelope"],
            "fase": envelope["fase"],
            "data_geracao": asn1.data_hora_je(envelope["cabecalho"]["dataGeracao"]),
            "identificacao": asn1.identificacao_urna(envelope["identificacao"]),
            "seguranca": asn1.jsonavel(envelope.get("seguranca")),
        },
        "identificacao": {
            "uf": uf,
            "municipio": sec["municipioZona"]["municipio"],
            "zona": sec["municipioZona"]["zona"],
            "local": sec["local"],
            "secao": sec["secao"],
        },
        "urna": asn1.urna(bu["urna"]),
        "data_hora_emissao": asn1.data_hora_je(bu["dataHoraEmissao"]),
        "tipo_dados": "secao" if dados_alt == "dadosSecao" else "sa",
        "data_hora_abertura": asn1.data_hora_je(dados.get("dataHoraAbertura")),
        "data_hora_encerramento": asn1.data_hora_je(dados.get("dataHoraEncerramento")),
        "data_hora_desligamento_voto_impresso": asn1.data_hora_je(
            dados.get("dataHoraDesligamentoVotoImpresso")
        ),
        "dados_sa": asn1.jsonavel(dados) if dados_alt == "dadosSA" else None,
        "eleitores_aptos": aptos,
        "comparecimento": comparecimento,
        "faltosos": aptos - comparecimento if aptos is not None and comparecimento is not None else None,
        "qtd_eleitores_lib_codigo": lib_codigo,
        "qtd_eleitores_comp_biometrico": comp_bio,
        "qtd_eleitores_compareceram": bu.get("qtdEleitoresCompareceram"),
        "detalhamento_comparecimento": detalhamento,
        "eleicoes": eleicoes,
        "totais_por_cargo": totais_por_cargo,
        "historico_correspondencias": [
            {"identificacao": asn1.identificacao_urna(h["identificacao"]), **asn1.carga(h["carga"])}
            for h in bu.get("historicoCorrespondencias") or []
        ],
        "historico_codigos_carga": list(bu["historicoCodigosCarga"]) if v2026 else None,
        "historico_voto_impresso": asn1.jsonavel(bu.get("historicoVotoImpresso") or []),
        "chave_assinatura_votos_votavel": chave_assin.hex() if chave_assin is not None else None,
        "cadeia_hash": verificar_cadeia_hash(bu, versao_spec) if v2026 else None,
        "raw": asn1.jsonavel({"envelope": envelope, "bu": bu}),
    }


def campos_comparaveis(bu_dict: dict[str, Any]) -> dict[str, Any]:
    """Dict plano com as mesmas chaves de ``imgbu.campos_comparaveis_imgbu``.

    Contagens zeradas de candidato/legenda/partido são omitidas (o BU não traz
    tuplas com zero; o imgbu imprime "Votos de legenda 0000").
    """
    urna = bu_dict["urna"]
    out: dict[str, Any] = {
        "municipio": bu_dict["identificacao"]["municipio"],
        "zona": bu_dict["identificacao"]["zona"],
        "local": bu_dict["identificacao"]["local"],
        "secao": bu_dict["identificacao"]["secao"],
        "eleitores_aptos": bu_dict["eleitores_aptos"],
        "comparecimento": bu_dict["comparecimento"],
        "faltosos": bu_dict["faltosos"],
        "habilitados_ano_nascimento": bu_dict["qtd_eleitores_lib_codigo"],
        "numero_interno_urna": urna["numero_interno_urna"],
        "data_hora_abertura": bu_dict["data_hora_abertura"],
        "data_hora_encerramento": bu_dict["data_hora_encerramento"],
        "codigo_carga": urna["codigo_carga"],
        "versao": urna["versao_numero"],
    }
    if bu_dict.get("versao_spec", "2022") != "2022":  # campos impressos só no imgbu de 2026
        det = bu_dict["detalhamento_comparecimento"] or {}
        e0 = bu_dict["eleicoes"][0] if bu_dict["eleicoes"] else {}
        out.update({
            "eleitores_aptos_secao": e0.get("eleitores_aptos_secao"),
            "eleitores_aptos_tte": e0.get("eleitores_aptos_tte"),
            "habilitacao_biometrica": det.get("habilitados_por_biometria"),
            "habilitacao_sem_biometria": det.get("sem_biometria"),
            "historico_codigos_carga": bu_dict["historico_codigos_carga"],
        })
        aptos_eleicao = {e["id_eleicao"]: e for e in bu_dict["eleicoes"]}
    for cargo, t in bu_dict["totais_por_cargo"].items():
        out[f"{cargo}.eleitores_aptos"] = t["eleitores_aptos"]
        if bu_dict.get("versao_spec", "2022") != "2022":
            e = aptos_eleicao[t["id_eleicao"]]
            out[f"{cargo}.eleitores_aptos_secao"] = e["eleitores_aptos_secao"]
            out[f"{cargo}.eleitores_aptos_tte"] = e["eleitores_aptos_tte"]
        for numero, q in t["nominal"].items():
            if q:
                out[f"{cargo}.nominal.{numero}"] = q
        for partido, q in t["legenda"].items():
            if q:
                out[f"{cargo}.legenda.{partido}"] = q
        if t["tipo_cargo"] == "proporcional":
            for partido, q in t["partido"].items():
                if q:
                    out[f"{cargo}.partido.{partido}"] = q
            out[f"{cargo}.total_legenda"] = t["total_legenda"]
        out[f"{cargo}.total_nominal"] = t["total_nominal"]
        out[f"{cargo}.branco"] = t["branco"]
        out[f"{cargo}.nulo"] = t["nulo"]
        out[f"{cargo}.total_apurado"] = t["total_apurado"]
    return out
