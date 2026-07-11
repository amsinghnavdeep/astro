"""SadTalker lip-sync engine (realistic head motion + blinks + expressions).

SadTalker has heavy, conflicting dependencies, so it lives in its own virtualenv
and we shell out to it. Configure the paths via env vars or the defaults below:

  SADTALKER_DIR    path to the cloned SadTalker repo
  SADTALKER_PYTHON python interpreter of the SadTalker venv

Returns a talking-head video (audio muxed in) that the rest of the pipeline
composes exactly like the Wav2Lip output.
"""
import glob
import os
import shutil
import subprocess

SADTALKER_DIR = os.environ.get("SADTALKER_DIR", "/home/ubuntu/SadTalker")
SADTALKER_PYTHON = os.environ.get(
    "SADTALKER_PYTHON", "/home/ubuntu/sadtalker-venv/bin/python")


def available():
    return os.path.isdir(SADTALKER_DIR) and os.path.exists(SADTALKER_PYTHON)


def lipsync(avatar_img, audio_path, out_path, workdir,
            preprocess="full", still=False, enhancer="gfpgan", cpu=True):
    """Animate `avatar_img` to `audio_path` with SadTalker; write to out_path."""
    if not available():
        raise RuntimeError(
            f"SadTalker not found. Set SADTALKER_DIR / SADTALKER_PYTHON. "
            f"Looked in {SADTALKER_DIR} and {SADTALKER_PYTHON}.")

    result_dir = os.path.join(workdir, "sadtalker")
    os.makedirs(result_dir, exist_ok=True)

    cmd = [
        SADTALKER_PYTHON, "inference.py",
        "--driven_audio", os.path.abspath(audio_path),
        "--source_image", os.path.abspath(avatar_img),
        "--result_dir", os.path.abspath(result_dir),
        "--preprocess", preprocess,
    ]
    if enhancer:
        cmd += ["--enhancer", enhancer]
    if still:
        cmd += ["--still"]
    if cpu:
        cmd += ["--cpu"]

    subprocess.run(cmd, cwd=SADTALKER_DIR, check=True)

    # SadTalker writes a timestamped mp4 (….mp4) into result_dir.
    vids = sorted(glob.glob(os.path.join(result_dir, "*.mp4")),
                  key=os.path.getmtime)
    if not vids:
        raise RuntimeError("SadTalker produced no output video.")
    shutil.copy(vids[-1], out_path)
    return out_path
