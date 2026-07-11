# Talking-Avatar Reel

Turn a **script + one photo** into a vertical (9:16) reel of that person *speaking*
the script — with voiceover, lip-sync, burned-in captions, and a choice of
backgrounds (podcast studio / green screen / transparent / blurred).

The same avatar photo is reused for every video; you just change the script.

## How it works

```
script.txt ─▶ voiceover ─▶ Wav2Lip (lip-sync to photo)
           │   edge-tts  OR  XTTS-v2 (clone YOUR voice)
           ─▶ [GFPGAN face enhance]  ─▶ [rembg cutout + background]
           ─▶ ffmpeg compose (9:16 + captions) ─▶ reel.mp4
```

All components are open-source and run locally.

| Stage        | Tool            | Notes                                    |
|--------------|-----------------|------------------------------------------|
| Voiceover    | `edge-tts`      | Free neural voices; Hindi + many langs   |
| Voice clone  | `coqui-tts` (XTTS-v2) | Clone a real voice from a short clip |
| Lip-sync     | `Wav2Lip`       | Drives the mouth from the audio          |
| Face detail  | `GFPGAN` (opt.) | Sharpens/realifies the face              |
| Cutout/bg    | `rembg` (opt.)  | Green screen / podcast / transparent     |
| Compositing  | `ffmpeg`        | 9:16 layout, captions, encode            |

A ready-made photorealistic **Pandit ji** avatar (AI-generated) ships as the
default at `avatars/panditji.png`.

## Setup

Requires Python 3.10+, `ffmpeg`, and a Devanagari font for Hindi captions
(`sudo apt-get install -y ffmpeg fonts-noto`).

```bash
bash setup.sh        # installs deps, clones Wav2Lip, downloads model weights
```

## Usage

```bash
# Built-in neural voice:
python3 src/make_reel.py \
  --script examples/script_saturn.txt \
  --avatar avatars/panditji.png \
  --voice hi-IN-MadhurNeural \
  --background podcast \
  --out out/reel.mp4
```

### Clone your own voice

Drop a **10–60 s** clip of the target voice in `voices/` and pass `--voice-sample`.
XTTS-v2 clones it (cross-lingual — an English sample can speak Hindi):

```bash
python3 src/make_reel.py \
  --script examples/script_saturn.txt \
  --avatar avatars/panditji.png \
  --voice-sample voices/creator_voice.wav \
  --language hi \
  --background podcast \
  --out out/reel.mp4
```

`--voice-sample` overrides `--voice`. First run downloads the XTTS model (~1.8 GB)
and auto-accepts its **non-commercial** license. Digits in Hindi scripts are
spoken correctly (converted to Hindi words automatically).

### Generate a new avatar (optional)

Create a fresh photorealistic character from a text prompt (open-source Stable
Diffusion, Realistic Vision). Either as a step of a reel, or standalone:

```bash
# as part of a reel (generates, then uses it):
python3 src/make_reel.py \
  --generate-avatar "head and shoulders portrait of a calm Indian pandit, saffron kurta, rudraksha mala, studio light, photorealistic" \
  --avatar avatars/my_pandit.png --avatar-seed 12 \
  --script examples/script_test.txt --voice-sample voices/creator_voice.wav \
  --language hi --out out/reel.mp4

# standalone (just the image):
python3 src/gen_avatar.py --prompt "..." --out avatars/new.png --seed 7
```

Change `--avatar-seed` for a different face. CPU ~3 min/image; add `--gpu` on a
CUDA machine. The bundled `avatars/panditji.png` was made this way.

### Realistic motion (SadTalker)

Wav2Lip animates only the mouth on a still photo (fast, but the head is frozen).
For a **realistic talking person** — natural head motion, blinks, expressions —
use the SadTalker engine:

```bash
bash setup_sadtalker.sh    # one-time: isolated venv + ~2GB models

SADTALKER_DIR=third_party/SadTalker SADTALKER_PYTHON=.sadtalker-venv/bin/python \
python3 src/make_reel.py --engine sadtalker \
  --script examples/script_test.txt --avatar avatars/panditji.png \
  --voice-sample voices/creator_voice.wav --language hi \
  --enhance --background blur --out out/reel_realistic.mp4
```

SadTalker is **much heavier**: ~20 s/frame on CPU (an hour for a short clip),
near real-time on a GPU. Use Wav2Lip for quick drafts, SadTalker for the real thing.

### Key options

| Flag            | Default              | Description                                            |
|-----------------|----------------------|--------------------------------------------------------|
| `--script`      | —                    | Script text file (supports `[N sec]` pause markers).   |
| `--avatar`      | —                    | Front-facing photo of the person.                      |
| `--voice`       | `hi-IN-MadhurNeural` | edge-tts voice (used when `--voice-sample` is absent). |
| `--voice-sample`| —                    | Audio clip to CLONE the voice (XTTS-v2). Overrides `--voice`. |
| `--language`    | `hi`                 | Language for the cloned voice (`hi`, `en`, ...).       |
| `--engine`      | `wav2lip`            | `wav2lip` (fast, still) or `sadtalker` (realistic motion). |
| `--rate`/`--pitch` | `-4%` / `-2Hz`    | Speech pacing / pitch (edge-tts only).                 |
| `--background`  | `blur`               | `blur` \| `podcast` \| `green` \| `transparent`.       |
| `--enhance`     | off                  | GFPGAN face enhancement (much better, slow on CPU).    |
| `--no-captions` | off                  | Disable burned-in captions.                            |
| `--font`        | `Noto Sans Devanagari` | Caption font family.                                 |

### Backgrounds

- **`green`** — solid chroma-green; replace the background in any editor (CapCut/Premiere).
- **`podcast`** — synthesized studio backdrop (soft lights + vignette).
- **`transparent`** — alpha WebM; drop the person over any footage, no keying.
- **`blur`** — constant blurred version of the avatar photo (default).

## Script format

Plain UTF-8 text. Use `[N sec]` markers to split segments and add pauses:

```
पहली लाइन का स्क्रिप्ट। [5 sec]
दूसरा हिस्सा यहाँ। [10 sec]
आख़िरी कॉल-टू-एक्शन। ₹1,999 / $49
```

No markers? Separate segments with blank lines. Lines containing prices (`₹`, `$`)
or CTA words (`book`/`बुक`, `link`/`लिंक`) are auto-highlighted in the captions.

Numbers and `₹`/`$` amounts are converted to spoken Hindi words automatically
for the cloned voice (e.g. `₹1,999` → "एक हज़ार नौ सौ निन्यानवे रुपये").

## Performance

CPU works but is slow; a GPU is strongly recommended.

| Step                | CPU (2 cores)     | GPU            |
|---------------------|-------------------|----------------|
| Voiceover + lip-sync| ~2–3 min          | seconds        |
| GFPGAN `--enhance`  | ~4 s/frame (~2 h for 80 s) | ~real-time |

Skip `--enhance` for a fast draft; add it for the final render (ideally on GPU).

## Tested samples

`samples/` contains real outputs generated by this app (short test script,
without `--enhance`):

- `sample_cloned_blur.mp4` — Pandit ji speaking in a **cloned voice** (blur bg)
- `sample_green.mp4` — `--background green` (chroma-key ready)
- `sample_blur.mp4`  — `--background blur` (default look)

## Adding a new avatar

Drop a clear, front-facing photo in `avatars/` and pass it with `--avatar`.
Higher-resolution photos give sharper results.

## Credits / licenses

Wav2Lip, GFPGAN, rembg, edge-tts, ffmpeg — see each project for its license.
Wav2Lip weights are for research/personal use; check terms before commercial use.
Coqui **XTTS-v2** (voice cloning) is under the Coqui Public Model License
(**non-commercial**). For commercial voice cloning, use a licensed alternative.
Only clone voices you have permission to use.
