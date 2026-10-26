#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"

if [[ ! -d node_modules ]]; then
  echo "Preparando o editor pela primeira vez..."
  npm install
fi

echo "Abra http://127.0.0.1:5173 no navegador."
npm run dev
