# Astro Free — Talking Avatar Video Generator

100% free, no paid API. Realistic business-grade talking avatar with hand + body movement.

## Engines

| Engine | License | Hand Movement | Speed |
|--------|---------|---------------|-------|
| EchoMimicV2 | Apache 2.0 | YES (semi-body) | Medium |
| MuseTalk v1.5 | Apache 2.0 | No (face only) | Fast |
| Hallo2 | MIT | No (face only) | Slow |

## Quick Start

### 1. Setup (one-time, ~20 min)
bash setup_free.sh

### 2. Full pipeline (text -> speech -> video)
python pipeline.py --script examples/script.txt --avatar avatars/panditji.png --engine echomimicv2

### 3. Use your own audio
python run.py echomimicv2 -a avatars/panditji.png -s my_audio.wav
python run.py hallo2 -a avatars/panditji.png -s my_audio.wav
python run.py musetalk -a avatars/panditji.png -s my_audio.wav

## TTS Voices (Free, edge-tts)
- hi-IN-MadhurNeural (Hindi Male)
- hi-IN-SwaraNeural (Hindi Female)
- en-IN-PrabhatNeural (English India Male)
- en-IN-NeerjaNeural (English India Female)

## Google Colab (no local GPU needed)
Open AstroFree_Colab.ipynb in Colab with T4 GPU (free).

## Avatar Image Tips
- Resolution: 1024x1024 recommended
- Front-facing, well-lit, clear face
- EchoMimicV2: use half-body image (hands visible)
- Hallo2/MuseTalk: face-only crop works best

## License
EchoMimicV2: Apache 2.0 | MuseTalk: Apache 2.0 | Hallo2: MIT | This wrapper: MIT