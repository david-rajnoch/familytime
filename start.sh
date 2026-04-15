#!/bin/bash
# Start FamilyTime — backend + frontend

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting FamilyTime backend..."
cd "$ROOT/backend"
PYTHONPATH=. .venv/bin/uvicorn main:app --host localhost --port 8000 &
BACKEND_PID=$!

echo "Starting FamilyTime frontend..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" INT TERM
wait
