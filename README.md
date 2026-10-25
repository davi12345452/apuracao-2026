# apuracao-2026

Painel local da apuração do 2º turno presidencial de 25/10/2026: exterior ao vivo, seção a seção,
antes das 17h; totalização oficial depois; abstenção, crescimento por candidato e duas projeções
do resultado final.

```
./run.sh start     # coletor + painel em http://127.0.0.1:8000
./run.sh status
./run.sh stop
```

## Fontes

| O quê | De onde |
|---|---|
| Exterior antes das 17h | Boletins de urna (`bu.dat`) publicados por seção em `resultados.tse.jus.br/oficial/ele2026/arquivo-urna/3221/...`, decodificados pelo parser do [analise-urnas](https://github.com/davi12345452/analise-urnas) |
| Totalização (17h em diante) | `ele2026/6258/dados/{br,uf,zz}/…-c0001-e006258-u.json` (votos) e `{uf}-e006258-ab.json` (avanço e abstenção por município) |
| Base 1º turno 2026 | `ele2026/6257/dados/{uf}/{uf}{mun}-c0001-e006257-u.json`, um por município (`python -m apuracao.bases 2026_1t`) |
| Base 2022 | Dados abertos do TSE (`votacao_candidato_munzona_2022`, `detalhe_votacao_munzona_2022`), só o CSV `_BR` baixado por Range (`python -m apuracao.bases 2022`) |
| País de cada cidade do exterior | `data/cidades_exterior.json`, extraído do `exterior.json` público de apuracao.ascaribe.tech |

O coletor é educado: ~5–10 requisições por segundo, para de consultar seções do exterior já recebidas
e só lê o arquivo de um município quando o `-ab` mostra que ele avançou.

## Projeções

Por município (`src/apuracao/projecao.py`): nos municípios apurados mede-se o desvio da fatia de Lula
em relação à base; o que falta recebe a fatia observada (municípios parciais) ou base + desvio médio
da UF, encolhido para a região e o Brasil quando a UF tem poucos votos. Comparecimento e votos
válidos seguem a mesma lógica. A faixa de 80% vem de bootstrap dos municípios + choque por UF.

- **vs 2º turno 2022**: base = Lula / (Lula + Bolsonaro) em 2022.
- **vs 1º turno 2026**: base = Lula no 1º turno + α × outros candidatos; α estimado por região.

Só aparecem a partir de 5% do eleitorado apurado.

## Testes

```
.venv/bin/python -m pytest -q                       # parsers (arquivos reais de 25/10) e matemática
.venv/bin/python scripts/backtest_2022.py           # projeção em 11 ordens de apuração de 2022
.venv/bin/python scripts/replay_2022.py [--servir 8001]   # TSE falso servindo 2022, coletor + painel reais
```

Critérios: erro ≤ 1,5 pp com 30% apurado e ≤ 0,7 pp com 60%; no ensaio, totais exatos no fim.

## Railway (Docker)

A imagem roda vigia, coletor e painel num container só (`Dockerfile`, `docker/entrypoint.sh`).

- `vendor/` tem a cópia mínima do `analise_urnas` (cliente HTTP, zip remoto, parser de BU e specs ASN.1).
- `seed/apuracao.db.gz` é a semente do banco: bases do 1º turno e de 2022 mais o que já tinha sido coletado. Na primeira subida, com o volume vazio, o container começa dela. Para atualizar: `sqlite3 data/apuracao.db ".backup /tmp/a.db"`, depois `sqlite3 /tmp/a.db "delete from evento; delete from saude; vacuum"` (a semente não leva log) e `gzip -9 -c /tmp/a.db > seed/apuracao.db.gz`.
- Na Railway: um serviço a partir deste repo (o `railway.json` já aponta o Dockerfile), um volume montado em `/data` e as variáveis `APURACAO_TG_TOKEN` e `APURACAO_TG_CHAT` para os avisos no Telegram. A porta vem de `PORT`, que a própria Railway define.
- O container usa `TZ=America/Sao_Paulo`: o código compara tudo com a hora de Brasília.
- Só uma instância deve mandar avisos. Ao ligar a Railway, desligue o Mac (`./run.sh stop`).
