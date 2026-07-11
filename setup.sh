#!/usr/bin/env bash
# One-time setup: installs deps, clones Wav2Lip, downloads model weights.
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "==> Python deps"
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt

echo "==> PyTorch (CPU by default)"
# For GPU, replace with the CUDA wheel from https://pytorch.org
# torch>=2.4 is required by transformers 4.57 (used by the XTTS voice cloner).
python3 -m pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 \
  --index-url https://download.pytorch.org/whl/cpu

echo "==> Clone Wav2Lip"
mkdir -p third_party
if [ ! -d third_party/Wav2Lip ]; then
  git clone --depth 1 https://github.com/Rudrabha/Wav2Lip.git third_party/Wav2Lip
fi

echo "==> Patch Wav2Lip for librosa >= 0.10 (keyword-only mel args)"
sed -i 's/librosa.filters.mel(hp.sample_rate, hp.n_fft,/librosa.filters.mel(sr=hp.sample_rate, n_fft=hp.n_fft,/' \
  third_party/Wav2Lip/audio.py || true

echo "==> Wav2Lip weights"
mkdir -p third_party/Wav2Lip/checkpoints
if [ ! -f third_party/Wav2Lip/checkpoints/wav2lip_gan.pth ]; then
  curl -L -o third_party/Wav2Lip/checkpoints/wav2lip_gan.pth \
    "https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth"
fi
if [ ! -f third_party/Wav2Lip/face_detection/detection/sfd/s3fd.pth ]; then
  curl -L -o third_party/Wav2Lip/face_detection/detection/sfd/s3fd.pth \
    "https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth"
fi

echo "==> GFPGAN weights (optional enhancement)"
mkdir -p models
if [ ! -f models/GFPGANv1.4.pth ]; then
  curl -L -o models/GFPGANv1.4.pth \
    "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth"
fi

echo "==> Patch basicsr (torchvision>=0.16 compat)"
DEG="$(python3 -c 'import basicsr,os;print(os.path.join(os.path.dirname(basicsr.__file__),"data","degradations.py"))')"
if [ -f "$DEG" ]; then
  sed -i 's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' "$DEG" || true
fi

echo "==> Fonts (Devanagari) — needed for Hindi captions"
if ! fc-list | grep -qi devanagari; then
  echo "   Install: sudo apt-get install -y fonts-noto  (or fonts-noto-devanagari)"
fi

echo "==> Voice cloning note"
echo "   XTTS-v2 downloads its model (~1.8GB) on first --voice-sample run and"
echo "   auto-accepts its non-commercial license (COQUI_TOS_AGREED=1 in voice.py)."

echo ""
echo "Setup complete. Try:"
echo "  # built-in neural voice:"
echo "  python3 src/make_reel.py --script examples/script_saturn.txt \\"
echo "      --avatar avatars/panditji.png --background podcast --out out/reel.mp4"
echo ""
echo "  # your cloned voice (drop a 10-60s clip in voices/):"
echo "  python3 src/make_reel.py --script examples/script_saturn.txt \\"
echo "      --avatar avatars/panditji.png --voice-sample voices/creator_voice.wav \\"
echo "      --language hi --background podcast --out out/reel.mp4"
