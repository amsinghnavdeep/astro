#!/usr/bin/env bash
# Optional: set up the SadTalker engine (--engine sadtalker) in an ISOLATED
# virtualenv, because its pinned deps (numpy 1.23, librosa 0.9, kornia 0.6.8)
# conflict with the main app env. Downloads ~2GB of models.
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

SADTALKER_DIR="${SADTALKER_DIR:-$ROOT/third_party/SadTalker}"
VENV="${SADTALKER_VENV:-$ROOT/.sadtalker-venv}"

echo "==> Clone SadTalker -> $SADTALKER_DIR"
mkdir -p "$(dirname "$SADTALKER_DIR")"
if [ ! -d "$SADTALKER_DIR" ]; then
  git clone --depth 1 https://github.com/OpenTalker/SadTalker.git "$SADTALKER_DIR"
fi

echo "==> Create venv -> $VENV"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --upgrade pip

echo "==> Install SadTalker deps (CPU torch)"
pip install torch==2.2.2 torchvision==0.17.2 \
  --index-url https://download.pytorch.org/whl/cpu
pip install -r "$SADTALKER_DIR/requirements.txt"

echo "==> Patch basicsr (torchvision>=0.16 compat)"
DEG="$VENV/lib/python3.10/site-packages/basicsr/data/degradations.py"
[ -f "$DEG" ] && sed -i \
  's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' \
  "$DEG" || true

echo "==> Download SadTalker models (~2GB)"
( cd "$SADTALKER_DIR" && bash scripts/download_models.sh )

deactivate
echo ""
echo "SadTalker ready. Run the app with:"
echo "  SADTALKER_DIR=$SADTALKER_DIR SADTALKER_PYTHON=$VENV/bin/python \\"
echo "  python3 src/make_reel.py --engine sadtalker \\"
echo "      --script examples/script_test.txt --avatar avatars/panditji.png \\"
echo "      --voice-sample voices/creator_voice.wav --language hi \\"
echo "      --enhance --out out/reel_realistic.mp4"
