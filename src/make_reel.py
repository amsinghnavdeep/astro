#!/usr/bin/env python3
"""Talking-Avatar Reel generator.

Give it a SCRIPT and a fixed AVATAR photo; it produces a vertical (9:16) reel of
the avatar speaking the script, with lip-sync, a voiceover, burned-in captions,
and a choice of backgrounds (podcast studio / green screen / transparent / blur).

Pipeline: edge-tts (voice) -> Wav2Lip (lip-sync) -> [GFPGAN enhance] ->
          [rembg cutout + background] -> ffmpeg compose.

Examples
--------
  # cloned voice (sound like a specific person):
  python src/make_reel.py --script examples/script_saturn.txt \
      --avatar avatars/panditji.png --voice-sample voices/my_voice.wav \
      --language hi --background podcast --enhance --out out/reel.mp4

  # built-in neural voice (no cloning):
  python src/make_reel.py --script examples/script_saturn.txt \
      --avatar avatars/panditji.png --voice hi-IN-MadhurNeural \
      --background podcast --out out/reel.mp4
"""
import argparse
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import tts          # noqa: E402
import captions     # noqa: E402
import lipsync      # noqa: E402
import compose      # noqa: E402


def voice_prep(sample, workdir):
    """Normalize any input audio to a clean 22.05kHz mono wav for cloning."""
    import subprocess
    ref = os.path.join(workdir, "voice_ref.wav")
    subprocess.run(["ffmpeg", "-y", "-i", sample, "-ar", "22050", "-ac", "1",
                    ref], capture_output=True)
    return ref


def main():
    ap = argparse.ArgumentParser(description="Generate a talking-avatar reel.")
    ap.add_argument("--script", required=True,
                    help="Path to script text file (supports [N sec] pause markers).")
    ap.add_argument("--avatar", default=None,
                    help="Avatar photo (front-facing). Omit when using "
                         "--generate-avatar.")
    ap.add_argument("--generate-avatar", default=None, metavar="PROMPT",
                    help="Generate a NEW avatar from this text prompt "
                         "(Stable Diffusion) and use it. Saved to --avatar path "
                         "or avatars/generated.png.")
    ap.add_argument("--avatar-seed", type=int, default=12,
                    help="Seed for --generate-avatar (change for a new face).")
    ap.add_argument("--out", default="out/reel.mp4", help="Output video path.")
    ap.add_argument("--voice", default="hi-IN-MadhurNeural",
                    help="edge-tts voice (used when --voice-sample is NOT given).")
    ap.add_argument("--voice-sample", default=None,
                    help="Reference audio (wav/mp3, ~10-60s) to CLONE the voice "
                         "via XTTS-v2. Overrides --voice.")
    ap.add_argument("--language", default="hi",
                    help="Language code for cloned voice (hi, en, es, ...).")
    ap.add_argument("--rate", default="-4%", help="Speech rate, e.g. -10%%..+10%%.")
    ap.add_argument("--pitch", default="-2Hz", help="Voice pitch, e.g. -2Hz.")
    ap.add_argument("--engine", default="wav2lip",
                    choices=["wav2lip", "sadtalker"],
                    help="Lip-sync engine. wav2lip=fast talking photo; "
                         "sadtalker=realistic head motion/blinks (slow on CPU).")
    ap.add_argument("--background", default="blur",
                    choices=["blur", "podcast", "green", "transparent"],
                    help="Background style.")
    ap.add_argument("--enhance", action="store_true",
                    help="GFPGAN face enhancement (sharper, but slow on CPU).")
    ap.add_argument("--no-captions", action="store_true", help="Disable captions.")
    ap.add_argument("--font", default="Noto Sans Devanagari",
                    help="Caption font family (must be installed).")
    ap.add_argument("--fps", type=int, default=25)
    ap.add_argument("--workdir", default=None,
                    help="Working dir for intermediates (default: temp).")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    workdir = args.workdir or tempfile.mkdtemp(prefix="reel_")
    os.makedirs(workdir, exist_ok=True)
    print(f"[workdir] {workdir}")

    if args.generate_avatar:
        import gen_avatar
        avatar_out = args.avatar or "avatars/generated.png"
        print(f"[0/4] generating avatar (Stable Diffusion) — slow on CPU…")
        args.avatar = gen_avatar.generate(
            prompt=args.generate_avatar, out=avatar_out, seed=args.avatar_seed)
    if not args.avatar:
        ap.error("--avatar is required (or use --generate-avatar).")

    with open(args.script, encoding="utf-8") as f:
        script_text = f.read()
    segments = tts.parse_script(script_text)
    print(f"[script] {len(segments)} segment(s)")

    if args.voice_sample:
        print(f"[1/4] voiceover (cloning {os.path.basename(args.voice_sample)})…")
        import voice
        ref = voice_prep(args.voice_sample, workdir)
        voiceover, meta = voice.generate_voiceover(
            segments, ref, workdir, language=args.language)
    else:
        print(f"[1/4] voiceover (edge-tts {args.voice})…")
        voiceover, meta = tts.generate_voiceover(
            segments, args.voice, workdir, rate=args.rate, pitch=args.pitch)

    ass_file = None
    if not args.no_captions:
        ass_file = os.path.join(workdir, "caps.ass")
        captions.build_ass(meta, ass_file, font=args.font)

    talking = os.path.join(workdir, "talking_raw.mp4")
    if args.engine == "sadtalker":
        print("[2/4] lip-sync (SadTalker — realistic motion, slow on CPU)…")
        import sadtalker
        # SadTalker enhances internally, so --enhance is folded in here.
        sadtalker.lipsync(args.avatar, voiceover, talking, workdir,
                          enhancer="gfpgan" if args.enhance else None)
        print("[3/4] enhancement handled by SadTalker")
    else:
        print("[2/4] lip-sync (Wav2Lip)…")
        lipsync.lipsync(args.avatar, voiceover, talking)
        if args.enhance:
            print("[3/4] face enhancement (GFPGAN) — slow on CPU…")
            enhanced = os.path.join(workdir, "talking_enh.mp4")
            lipsync.enhance_faces(talking, voiceover, enhanced, workdir,
                                  fps=args.fps)
            talking = enhanced
        else:
            print("[3/4] skipping enhancement (--enhance to enable)")

    print(f"[4/4] compose ({args.background})…")
    if args.background == "blur":
        compose.compose_reel(talking, args.avatar, ass_file, args.out, fps=args.fps)
    else:
        import background
        background.render_with_cutout(
            talking, voiceover, ass_file, args.out, workdir,
            mode=args.background, fps=args.fps)

    print(f"\n✓ Done: {args.out}")


if __name__ == "__main__":
    main()
