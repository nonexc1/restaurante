#!/usr/bin/env bash
# Instala (la primera vez) y abre la CRM en Mac o Linux:  ./iniciar.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "No tienes Node.js. Instala la versión LTS desde https://nodejs.org y vuelve a ejecutar este archivo."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Instalando dependencias, espera un momento..."
  npm install || exit 1
fi

node scripts/setup-local.js || exit 1

( sleep 3; (command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) ) >/dev/null 2>&1 &
npm start
