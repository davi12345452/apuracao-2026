# Painel da apuração: vigia + coletor + servidor num container só.
FROM python:3.14-slim

# curl: mercados (DoH); tzdata/TZ: o código usa a hora de Brasília (17h, boletins, chaves dos avisos)
RUN apt-get update && apt-get install -y --no-install-recommends curl tzdata sqlite3 \
    && rm -rf /var/lib/apt/lists/*
ENV TZ=America/Sao_Paulo \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src:/app/vendor \
    ANALISE_URNAS_SPECS_DIR=/app/vendor/specs \
    APURACAO_DATA=/data \
    APURACAO_DB=/data/apuracao.db \
    APURACAO_HOST=0.0.0.0 \
    APURACAO_ALERTAS=1 \
    APURACAO_PUBLICO=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
COPY vendor ./vendor
COPY data/cidades_exterior.json data/ensaio_2022.json ./data/
COPY seed ./seed
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && useradd --system --uid 10001 --no-create-home app

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
