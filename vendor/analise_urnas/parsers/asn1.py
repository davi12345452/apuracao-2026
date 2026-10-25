"""Carregador das especificações ASN.1 do TSE (diretório ``specs/``), por versão.

Há duas versões de spec:

- ``"2022"``: ``specs/*.asn1``, pacote oficial do TSE de 17/09/2022 (software 8.x);
- ``"2026"``: ``specs/2026/*.asn1``, **reconstrução não oficial** (ver ``specs/2026/FONTE.md``)
  que decodifica byte a byte os arquivos de 2026 (software 10.23.0.0). Estruturalmente é a
  mesma forma da spec v2 publicada para 2024, então também deve servir para 2024 (não testado).

As specs são compiladas com ``asn1tools`` usando o codec BER (o README oficial do TSE diz que
BU e RDV são codificados em BER) e ficam em cache no módulo.

Detecção de versão (``detectar_versao``): BU (conteúdo do envelope), RDV e envelope do imgbu
trazem ``Urna.versaoVotacao`` (ex. ``"10.23.0.0 - Praia da Barra do Cahy"``) numa posição que
não mudou entre as versões: 3º elemento da SEQUENCE externa, 2º membro dele. Lemos essa string
com um walker BER mínimo (sem depender da spec) e mapeamos o número principal: ``8`` -> 2022,
``>= 9`` -> 2026. Se a string não for encontrada, os parsers tentam as versões em ordem
(``ORDEM_TENTATIVA``) e ficam com a primeira que decodifica sem erro.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, TypeVar

import asn1tools

CODEC = "ber"

#: Versões de spec disponíveis.
VERSOES: tuple[str, ...] = ("2022", "2026")

#: Ordem usada quando não dá para detectar a versão pelos bytes.
ORDEM_TENTATIVA: tuple[str, ...] = ("2022", "2026")

#: Arquivo de spec por nome lógico.
SPECS: dict[str, str] = {
    "bu": "bu.asn1",
    "rdv": "rdv.asn1",
    "assinatura": "assinatura.asn1",
}

#: Subdiretório de ``specs/`` por versão ("" = raiz, spec oficial de 2022).
SUBDIR_VERSAO: dict[str, str] = {"2022": "", "2026": "2026"}

T = TypeVar("T")


def specs_dir() -> Path:
    """Diretório das specs (sobrescrevível por ``ANALISE_URNAS_SPECS_DIR``)."""
    env = os.environ.get("ANALISE_URNAS_SPECS_DIR")
    if env:
        return Path(env)
    # src/analise_urnas/parsers/asn1.py -> raiz do repositório
    return Path(__file__).resolve().parents[3] / "specs"


class SpecAusenteError(FileNotFoundError):
    """Arquivo de spec ausente (a de 2026 não é versionada: baixe com ``urnas specs``)."""


def _checar_versao(versao: str) -> str:
    if versao not in SUBDIR_VERSAO:
        raise ValueError(f"versão de spec desconhecida: {versao!r} (opções: {list(VERSOES)})")
    return versao


def _spec_path(nome: str, versao: str = "2022") -> Path:
    _checar_versao(versao)
    try:
        arquivo = SPECS[nome]
    except KeyError:
        raise ValueError(f"spec desconhecida: {nome!r} (opções: {sorted(SPECS)})") from None
    sub = SUBDIR_VERSAO[versao]
    caminho = (specs_dir() / sub / arquivo) if sub else (specs_dir() / arquivo)
    if not caminho.is_file():
        dica = "rode `urnas specs`" if sub else "ela é versionada em specs/ (restaure do git)"
        raise SpecAusenteError(f"Spec ASN.1 de {versao} ausente ({caminho}): {dica}")
    return caminho


@lru_cache(maxsize=None)
def compilar(nome: str, versao: str = "2022") -> asn1tools.compiler.Specification:
    """Compila (uma vez) a spec ``nome`` ('bu', 'rdv' ou 'assinatura') da ``versao`` ('2022'/'2026')."""
    return asn1tools.compile_files([str(_spec_path(nome, versao))], codec=CODEC)


@lru_cache(maxsize=None)
def enums(nome: str, versao: str = "2022") -> dict[str, dict[str, int]]:
    """Mapas ``{TipoEnum: {nome_valor: inteiro}}`` lidos da própria spec."""
    parsed = asn1tools.parse_files([str(_spec_path(nome, versao))])
    out: dict[str, dict[str, int]] = {}
    for modulo in parsed.values():
        for tipo, definicao in modulo["types"].items():
            if definicao.get("type") == "ENUMERATED":
                out[tipo] = {k: v for k, v in definicao["values"] if k is not None}
    return out


# --------------------------------------------------------------------------- detecção de versão


def _tlv(dados: bytes, i: int) -> tuple[int, int, int]:
    """Lê um cabeçalho BER em ``i``; devolve ``(primeiro_byte_tag, inicio_valor, fim_valor)``."""
    t = dados[i]
    i += 1
    if t & 0x1F == 0x1F:  # tag em vários bytes
        while dados[i] & 0x80:
            i += 1
        i += 1
    n = dados[i]
    i += 1
    if n & 0x80:
        k = n & 0x7F
        if k == 0 or k > 4:  # forma indefinida ou absurda: desistir
            raise ValueError("comprimento BER não suportado")
        n = int.from_bytes(dados[i:i + k], "big")
        i += k
    fim = i + n
    if fim > len(dados):
        raise ValueError("TLV além do fim")
    return t, i, fim


def _filhos(dados: bytes, inicio: int, fim: int, maximo: int) -> list[tuple[int, int, int]]:
    out = []
    i = inicio
    while i < fim and len(out) < maximo:
        t, a, b = _tlv(dados, i)
        out.append((t, a, b))
        i = b
    return out


def versao_votacao_bruta(dados: bytes) -> str | None:
    """Extrai ``Urna.versaoVotacao`` sem usar spec (None se a estrutura não bater).

    Funciona para ``EntidadeBoletimUrna``, ``EntidadeResultadoRDV`` e
    ``EntidadeEnvelopeGenerico`` com ``urna`` presente (imgbu): ``Urna`` é o 3º elemento da
    SEQUENCE externa no BU/envelope e o 2º no RDV (``{cabecalho, urna, rdv}``), e
    ``versaoVotacao`` (GeneralString) é o 2º membro de ``Urna``. Tenta o 3º e depois o 2º.
    """
    try:
        t, a, b = _tlv(dados, 0)
        if t != 0x30:
            return None
        elems = _filhos(dados, a, b, 3)
        for idx in (2, 1):
            if len(elems) <= idx or elems[idx][0] != 0x30:
                continue
            membros = _filhos(dados, elems[idx][1], elems[idx][2], 2)
            if len(membros) >= 2 and membros[0][0] == 0x0A and membros[1][0] == 0x1B:
                return dados[membros[1][1]:membros[1][2]].decode("latin-1")
        return None
    except (IndexError, ValueError):
        return None


def versao_spec_do_software(versao_votacao: str | None) -> str | None:
    """Mapeia a versão do software de votação para a versão de spec ('2022' ou '2026')."""
    if not versao_votacao:
        return None
    m = re.match(r"\s*(\d+)\.", versao_votacao)
    if not m:
        return None
    return "2022" if int(m.group(1)) <= 8 else "2026"


def detectar_versao(dados: bytes) -> str | None:
    """Versão de spec a partir dos bytes (via ``versaoVotacao``); None se não der para saber."""
    return versao_spec_do_software(versao_votacao_bruta(dados))


def decodificar_versionado(
    decodificar: Callable[[str], T], versao: str | None, detectada: str | None
) -> tuple[T, str]:
    """Roda ``decodificar(versao)`` com a versão forçada, a detectada ou, em último caso, cada uma.

    Com ``versao`` forçada não há fallback (o erro sobe). Com versão detectada, tenta ela
    primeiro e depois as outras; o erro da primeira tentativa é o que sobe se todas falharem.
    """
    if versao is not None:
        return decodificar(_checar_versao(versao)), versao
    ordem = list(ORDEM_TENTATIVA)
    if detectada in ordem:
        ordem.remove(detectada)
        ordem.insert(0, detectada)
    primeiro_erro: Exception | None = None
    ausente: SpecAusenteError | None = None
    for v in ordem:
        try:
            return decodificar(v), v
        except SpecAusenteError as e:
            ausente = ausente or e
            primeiro_erro = primeiro_erro or e
        except Exception as e:  # noqa: BLE001 - qualquer falha de decodificação: tentar a próxima
            primeiro_erro = primeiro_erro or e
    assert primeiro_erro is not None
    # Spec ausente é a causa provável (e acionável), a menos que os bytes digam que são de outra versão.
    if ausente is not None and detectada is None:
        raise ausente
    raise primeiro_erro


def ler_bytes(path_or_bytes: str | os.PathLike[str] | bytes | bytearray) -> bytes:
    """Aceita caminho ou bytes e devolve bytes."""
    if isinstance(path_or_bytes, (bytes, bytearray)):
        return bytes(path_or_bytes)
    return Path(path_or_bytes).read_bytes()


def jsonavel(obj: Any) -> Any:
    """Converte a saída do asn1tools em algo serializável em JSON.

    - ``bytes`` -> string hexadecimal;
    - CHOICE (tupla ``(alternativa, valor)``) -> ``{alternativa: valor}``.
    """
    if isinstance(obj, (bytes, bytearray)):
        return bytes(obj).hex()
    if isinstance(obj, dict):
        return {k: jsonavel(v) for k, v in obj.items()}
    if isinstance(obj, tuple) and len(obj) == 2 and isinstance(obj[0], str):
        return {obj[0]: jsonavel(obj[1])}
    if isinstance(obj, (list, tuple)):
        return [jsonavel(v) for v in obj]
    return obj


def data_hora_je(valor: str | None) -> str | None:
    """Converte ``DataHoraJE`` (YYYYMMDDThhmmss) em ISO 8601 sem fuso (hora local da urna)."""
    if not valor:
        return None
    return datetime.strptime(valor, "%Y%m%dT%H%M%S").isoformat()


def choice(valor: tuple[str, Any] | None) -> tuple[str | None, Any]:
    """Desempacota um CHOICE do asn1tools (tolerando ``None``)."""
    if valor is None:
        return None, None
    return valor[0], valor[1]


def identificacao_urna(valor: tuple[str, Any] | None) -> dict[str, Any] | None:
    """Normaliza o CHOICE ``IdentificacaoUrna`` (seção ou contingência)."""
    alt, v = choice(valor)
    if alt is None:
        return None
    mz = v["municipioZona"]
    return {
        "tipo": "secao" if alt == "identificacaoSecaoEleitoral" else "contingencia",
        "municipio": mz["municipio"],
        "zona": mz["zona"],
        "local": v.get("local"),
        "secao": v.get("secao"),
    }


def carga(valor: dict[str, Any]) -> dict[str, Any]:
    """Normaliza ``Carga`` (comum a BU e RDV).

    ``identificador_gerador_midia`` (spec 2026) identifica a máquina que gerou a mídia de carga:
    ``{nome, serial_certificado_tpm, serial_instalacao}``; ``None`` em 2022.
    """
    ger = valor.get("identificadorGeradorMidia")
    return {
        "numero_interno_urna": valor["numeroInternoUrna"],
        "numero_serie_fc": valor["numeroSerieFC"].hex(),
        "data_hora_carga": data_hora_je(valor["dataHoraCarga"]),
        "codigo_carga": valor["codigoCarga"],
        "identificador_gerador_midia": {
            "nome": ger["nome"],
            "serial_certificado_tpm": ger["serialCertificadoTPM"],
            "serial_instalacao": ger["serialInstalacao"],
        } if ger else None,
    }


def urna(valor: dict[str, Any]) -> dict[str, Any]:
    """Normaliza ``Urna`` (comum a BU e RDV)."""
    corr = valor["correspondenciaResultado"]
    versao = valor["versaoVotacao"]
    return {
        "tipo_urna": valor["tipoUrna"],
        "tipo_arquivo": valor["tipoArquivo"],
        "versao_votacao": versao,
        "versao_numero": versao.split(" - ")[0].strip(),
        "numero_serie_fv": valor["numeroSerieFV"].hex(),
        "motivo_utilizacao_sa": jsonavel(valor.get("motivoUtilizacaoSA")),
        "identificacao_carga": identificacao_urna(corr["identificacao"]),
        **carga(corr["carga"]),
    }


def cargo(valor: tuple[str, Any], versao: str = "2022") -> tuple[str, int]:
    """CHOICE ``CodigoCargoConsulta`` -> (nome, código numérico).

    Cargo constitucional: nome do enum (ex. 'deputadoFederal') e seu valor na spec.
    Cargo/consulta livre: nome ``'consulta<N>'`` e o próprio número.
    """
    alt, v = choice(valor)
    if alt == "cargoConstitucional":
        return v, enums("bu", versao)["CargoConstitucional"][v]
    return f"consulta{v}", int(v)
