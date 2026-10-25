#!/bin/zsh
# Liga/desliga o coletor e o painel local. Uso: ./run.sh [start|stop|status]
cd "${0:A:h}"
case "${1:-start}" in
  start)
    for p in coletor server; do [ -f data/$p.pid ] && kill $(cat data/$p.pid) 2>/dev/null; done
    nohup nice -n 10 .venv/bin/python -m apuracao.coletor >> data/coletor.log 2>&1 & echo $! > data/coletor.pid
    nohup nice .venv/bin/python -m apuracao.server >> data/server.log 2>&1 & echo $! > data/server.pid
    echo "painel: http://127.0.0.1:8000" ;;
  stop)
    for p in coletor server; do [ -f data/$p.pid ] && kill $(cat data/$p.pid) 2>/dev/null && rm data/$p.pid; done ;;
  status)
    for p in coletor server; do
      if [ -f data/$p.pid ] && kill -0 $(cat data/$p.pid) 2>/dev/null; then echo "$p: rodando ($(cat data/$p.pid))"; else echo "$p: parado"; fi
    done ;;
esac
