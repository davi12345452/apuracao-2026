#!/bin/sh
# Primeira subida com volume vazio: começa do banco-semente (bases do 1º turno e de 2022 e o que
# já foi coletado), em vez de baixar tudo do TSE de novo. Depois o coletor segue de onde parou.
set -e
mkdir -p "$APURACAO_DATA"
if [ ! -s "$APURACAO_DB" ] && [ -f /app/seed/apuracao.db.gz ]; then
  echo "volume vazio: restaurando a semente em $APURACAO_DB"
  # arquivo temporário + mv: um gunzip interrompido não deixa um banco pela metade no lugar do real
  gunzip -c /app/seed/apuracao.db.gz > "$APURACAO_DB.tmp"
  mv "$APURACAO_DB.tmp" "$APURACAO_DB"
fi
# o volume da Railway chega como root: acerta o dono e roda o painel sem privilégio
chown -R app:app "$APURACAO_DATA"
exec setpriv --reuid=app --regid=app --init-groups --no-new-privs python -m apuracao.vigia
