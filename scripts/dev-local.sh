#!/usr/bin/env bash
# 本机一键启动（macOS / Linux）：后端 http://localhost:8000 + 前端 http://localhost:5173
# 首次运行会自动创建 backend/.venv 并安装依赖、在 frontend 执行 npm install。Ctrl+C 同时停止前后端。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PY="$(command -v python3.11 || command -v python3.12 || command -v python3.13 || command -v python3 || true)"
if [ -z "$PY" ] || ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "需要 Python 3.11 或以上（建议 3.11）。可用 brew install python@3.11 安装。" >&2; exit 1
fi
command -v npm >/dev/null || { echo "需要 Node.js 18 或以上（含 npm）。可用 brew install node 安装。" >&2; exit 1; }

cd "$ROOT/backend"
[ -x .venv/bin/python ] || "$PY" -m venv .venv
.venv/bin/python -c 'import fastapi, shapely, uvicorn' 2>/dev/null || .venv/bin/pip install -r requirements-dev.txt

cd "$ROOT/frontend"
[ -d node_modules ] || npm install

cd "$ROOT/backend"
.venv/bin/uvicorn app.main:app --reload --port 8000 &
BACK=$!
cd "$ROOT/frontend"
npm run dev &
FRONT=$!
trap 'kill $BACK $FRONT 2>/dev/null || true' INT TERM EXIT

sleep 3
echo
echo "  后台工作台： http://localhost:5173/workspace"
echo "  3D 演示：    http://localhost:5173/"
echo "  后端接口：   http://localhost:8000/api/health"
echo "  访问密钥：   python3 scripts/issue-workspace-key.py 可签发新的密钥"
echo
wait
