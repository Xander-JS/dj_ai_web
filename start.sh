#!/usr/bin/env bash

set -e

echo "=== [1/3] Limpiando puertos 5173 y 8000 ==="
# Libera los puertos directamente con fuser a nivel de usuario sin pedir sudo
fuser -k -9 5173/tcp 8000/tcp 2>/dev/null || true

# Por si quedó algún proceso zombi de vite o uvicorn huérfano
pkill -9 -f "vite" 2>/dev/null || true
pkill -9 -f "app.main" 2>/dev/null || true

# Función para apagar ambos procesos al pulsar Ctrl + C
cleanup() {
    echo ""
    echo "=== Deteniendo servidores... ==="
    # Matar los subprocesos iniciados por este script
    kill $(jobs -p) 2>/dev/null || true
    fuser -k -9 5173/tcp 8000/tcp 2>/dev/null || true
    echo "=== Entorno detenido y puertos liberados ==="
    exit 0
}

# Capturar Ctrl + C (SIGINT) y cierre de terminal (SIGTERM)
trap cleanup SIGINT SIGTERM

echo "=== [2/3] Levantando microservicio Python (FastAPI en :8000) ==="
(
    cd server
    ./.venv/bin/python -m app.main
) &

# Esperar 2 segundos a que el backend inicie el socket
sleep 2

echo "=== [3/3] Levantando frontend (Vite en :5173) ==="
npm run dev