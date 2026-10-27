#!/bin/zsh
# Liga/desliga o vigia, que sobe e supervisiona coletor e painel. Uso: ./run.sh [start|stop|status]
cd "${0:A:h}"
export PYTHONPATH=src:vendor ANALISE_URNAS_SPECS_DIR=vendor/specs
parar() {
  for p in vigia coletor server; do
    [ -f data/$p.pid ] && kill $(cat data/$p.pid) 2>/dev/null; rm -f data/$p.pid
  done
  pkill -f "apuracao\.(vigia|coletor|server)" 2>/dev/null
  sleep 1
}
case "${1:-start}" in
  start)
    parar
    nohup nice -n 5 .venv/bin/python -m apuracao.vigia >> data/vigia.log 2>&1 & echo $! > data/vigia.pid
    echo "painel: http://127.0.0.1:8000" ;;
  stop) parar ;;
  status)
    for p in vigia coletor server; do
      pid=$(pgrep -f "apuracao\.$p" | head -1)
      [ -n "$pid" ] && echo "$p: rodando ($pid)" || echo "$p: parado"
    done
    sqlite3 data/apuracao.db "select chave, ts, substr(valor,1,120) from saude order by chave" ;;
esac
