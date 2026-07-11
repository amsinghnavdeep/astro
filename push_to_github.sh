#!/usr/bin/env bash
# push_to_github.sh — One-click push to GitHub
# Run this on YOUR machine after extracting the zip:
#   bash push_to_github.sh

set -e

GITHUB_USER="amsinghnavdeep"
REPO_NAME="astro"
BRANCH="video-editor"
# SECURITY: never hardcode a token here. Export it before running:
#   export GITHUB_PAT=your_token   (or use a git credential helper)
PAT="${GITHUB_PAT:?Set GITHUB_PAT env var before running (do not hardcode tokens)}"
REMOTE="https://${GITHUB_USER}:${PAT}@github.com/${GITHUB_USER}/${REPO_NAME}.git"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="/tmp/astro_push_$$"

echo "=================================================="
echo "  Astro Free — GitHub Push"
echo "  github.com/${GITHUB_USER}/${REPO_NAME}  branch: ${BRANCH}"
echo "=================================================="

echo "Cloning repo..."
git clone --depth 1 -b "$BRANCH" "$REMOTE" "$WORK_DIR"

echo "Copying files..."
for f in run.py pipeline.py tts.py setup_free.sh requirements.txt README.md AstroFree_Colab.ipynb push_to_github.sh; do
    [[ -f "$SCRIPT_DIR/$f" ]] && cp "$SCRIPT_DIR/$f" "$WORK_DIR/$f" && echo "  $f" || true
done
mkdir -p "$WORK_DIR/examples"
[[ -f "$SCRIPT_DIR/examples/script.txt" ]] && cp "$SCRIPT_DIR/examples/script.txt" "$WORK_DIR/examples/script.txt" && echo "  examples/script.txt"

cat > "$WORK_DIR/.gitignore" << 'EOF'
engines/
output/
__pycache__/
*.pyc
.env
venv/
.DS_Store
EOF

cd "$WORK_DIR"
git config user.email "navdeepcingh1@gmail.com"
git config user.name "amsinghnavdeep"
git add -A
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
git commit -m "Add Astro Free: EchoMimicV2 + MuseTalk + Hallo2 pipeline [${TIMESTAMP}]" || echo "(nothing new to commit)"
git push origin "$BRANCH"

cd /tmp && rm -rf "$WORK_DIR"

echo ""
echo "DONE! Live at:"
echo "https://github.com/${GITHUB_USER}/${REPO_NAME}/tree/${BRANCH}"