"""Wrap Wav2Lip lip-sync and optional GFPGAN face enhancement."""
import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WAV2LIP_DIR = os.path.join(ROOT, "third_party", "Wav2Lip")
WAV2LIP_CKPT = os.path.join(WAV2LIP_DIR, "checkpoints", "wav2lip_gan.pth")
GFPGAN_MODEL = os.path.join(ROOT, "models", "GFPGANv1.4.pth")


def lipsync(avatar_img, audio_path, out_path, pads=(0, 15, 0, 0)):
    """Run Wav2Lip: still avatar image + audio -> talking-head video (with audio)."""
    if not os.path.exists(WAV2LIP_CKPT):
        raise FileNotFoundError(
            f"Wav2Lip checkpoint missing: {WAV2LIP_CKPT}. Run setup.sh first.")
    cmd = [
        sys.executable, "inference.py",
        "--checkpoint_path", WAV2LIP_CKPT,
        "--face", os.path.abspath(avatar_img),
        "--audio", os.path.abspath(audio_path),
        "--outfile", os.path.abspath(out_path),
        "--pads", *[str(p) for p in pads],
        "--nosmooth",
    ]
    subprocess.run(cmd, cwd=WAV2LIP_DIR, check=True)
    return out_path


def enhance_faces(in_video, audio_path, out_path, workdir, fps=25):
    """GFPGAN-enhance every frame of a talking-head video, then re-mux audio.

    Slow on CPU (~4s/frame). Resumable: already-enhanced frames are skipped.
    """
    import cv2
    os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
    import torch
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    from gfpgan import GFPGANer

    fin = os.path.join(workdir, "frames_in")
    fout = os.path.join(workdir, "frames_out")
    os.makedirs(fin, exist_ok=True)
    os.makedirs(fout, exist_ok=True)

    subprocess.run(
        ["ffmpeg", "-y", "-i", in_video, "-qscale:v", "2",
         os.path.join(fin, "f%05d.jpg")], check=True, capture_output=True)

    restorer = GFPGANer(model_path=GFPGAN_MODEL, upscale=1, arch="clean",
                        channel_multiplier=2, bg_upsampler=None)
    frames = sorted(glob.glob(os.path.join(fin, "*.jpg")))
    for i, f in enumerate(frames):
        dst = os.path.join(fout, os.path.basename(f))
        if os.path.exists(dst):
            continue
        img = cv2.imread(f)
        try:
            _, _, out = restorer.enhance(
                img, has_aligned=False, only_center_face=True, paste_back=True)
        except Exception:
            out = img
        cv2.imwrite(dst, out, [cv2.IMWRITE_JPEG_QUALITY, 95])
        if (i + 1) % 25 == 0:
            print(f"  enhanced {i+1}/{len(frames)}", flush=True)

    subprocess.run(
        ["ffmpeg", "-y", "-framerate", str(fps),
         "-i", os.path.join(fout, "f%05d.jpg"), "-i", audio_path,
         "-vf", "unsharp=5:5:0.4:5:5:0.0",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
         "-c:a", "aac", "-b:a", "192k", "-shortest", out_path],
        check=True, capture_output=True)
    return out_path
