#!/bin/sh
# Primeira subida com volume vazio: começa do banco-semente (bases do 1º turno e de 2022 e o que
# já foi coletado), em vez de baixar tudo do TSE de novo. Depois o coletor segue de onde parou.
set -e
mkdir -p "$APURACAO_DATA"
if [ ! -s "$APURACAO_DB" ] && [ -f /app/seed/apuracao.db.gz ]; then
  echo "volume vazio: restaurando a semente em $APURACAO_DB"
  gunzip -c /app/seed/apuracao.db.gz > "$APURACAO_DB"
fi
exec python -m apuracao.vigia
