"""Background handling: person cutout (rembg) + green / podcast / transparent / blur.

For green/podcast/transparent we segment the talking-head frames, composite each
onto the chosen backdrop at 9:16, then re-encode with audio. `blur` keeps the
original constant blurred-avatar look (handled in compose.py).
"""
import glob
import os
import subprocess

GREEN = (0x00, 0xB1, 0x40)  # standard chroma green (BGR handled below)
CARD_W = 900          # width the person is scaled to inside the 1080x1920 frame
CANVAS = (1080, 1920)


def _make_podcast_bg(path, w=1080, h=1920):
    """Synthesize a copyright-free 'podcast studio' backdrop: dark gradient +
    warm side glow + vignette. Static PNG."""
    vf = (
        "gradients=s=1080x1920:c0=0x1b1030:c1=0x2c1250:x0=0:y0=0:x1=1080:y1=1920,"
        "drawbox=x=120:y=520:w=360:h=360:color=0xff7a3c@0.18:t=fill,"
        "drawbox=x=640:y=380:w=420:h=420:color=0x3ca0ff@0.14:t=fill,"
        "boxblur=120:2,vignette=PI/4"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=1080x1920",
         "-vf", vf, "-frames:v", "1", path], check=True, capture_output=True)
    return path


def render_with_cutout(talking_video, audio_path, ass_file, out_path, workdir,
                       mode="podcast", fps=25):
    """Segment the person out of each frame and composite onto `mode` background."""
    import cv2
    import numpy as np
    from rembg import remove, new_session

    fin = os.path.join(workdir, "cut_in")
    fout = os.path.join(workdir, "cut_out")
    os.makedirs(fin, exist_ok=True)
    os.makedirs(fout, exist_ok=True)

    subprocess.run(
        ["ffmpeg", "-y", "-i", talking_video, "-qscale:v", "2",
         os.path.join(fin, "f%05d.jpg")], check=True, capture_output=True)

    session = new_session("u2net_human_seg")
    frames = sorted(glob.glob(os.path.join(fin, "*.jpg")))

    transparent = (mode == "transparent")
    if mode == "green":
        bg = np.zeros((CANVAS[1], CANVAS[0], 3), np.uint8)
        bg[:] = (GREEN[2], GREEN[1], GREEN[0])  # BGR
    elif mode == "podcast":
        bgp = os.path.join(workdir, "podcast_bg.png")
        _make_podcast_bg(bgp)
        bg = cv2.imread(bgp)
        bg = cv2.resize(bg, (CANVAS[0], CANVAS[1]))
    else:
        bg = None  # transparent

    for i, f in enumerate(frames):
        dst = os.path.join(fout, os.path.basename(f).replace(".jpg", ".png"))
        if os.path.exists(dst):
            continue
        img = cv2.imread(f)
        cut = remove(img, session=session)  # BGRA
        # scale person to CARD_W wide
        h, w = cut.shape[:2]
        scale = CARD_W / w
        nw, nh = int(w * scale), int(h * scale)
        cut = cv2.resize(cut, (nw, nh), interpolation=cv2.INTER_LANCZOS4)

        x = (CANVAS[0] - nw) // 2
        y = CANVAS[1] - nh - 260  # sit person a bit above bottom (room for captions)

        if transparent:
            canvas = np.zeros((CANVAS[1], CANVAS[0], 4), np.uint8)
            _paste_rgba(canvas, cut, x, y)
            cv2.imwrite(dst, canvas)
        else:
            canvas = bg.copy()
            _paste_over(canvas, cut, x, y)
            cv2.imwrite(dst, canvas, [cv2.IMWRITE_JPEG_QUALITY, 95] if False else [])
        if (i + 1) % 25 == 0:
            print(f"  cutout {i+1}/{len(frames)}", flush=True)

    # encode
    pattern = os.path.join(fout, "f%05d.png")
    if transparent:
        # alpha-capable webm (vp9)
        cmd = ["ffmpeg", "-y", "-framerate", str(fps), "-i", pattern,
               "-i", audio_path, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
               "-b:v", "3M", "-c:a", "libopus", "-shortest", out_path]
    else:
        vf = None
        cmd = ["ffmpeg", "-y", "-framerate", str(fps), "-i", pattern,
               "-i", audio_path]
        if ass_file:
            ass_esc = ass_file.replace("\\", "\\\\").replace(":", "\\:")
            cmd += ["-vf", f"ass={ass_esc}"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                "-c:a", "aac", "-b:a", "192k", "-shortest", out_path]
    subprocess.run(cmd, check=True)
    return out_path


def _paste_over(canvas, rgba, x, y):
    """Alpha-composite a BGRA patch onto a BGR canvas at (x, y)."""
    import numpy as np
    ch, cw = canvas.shape[:2]
    h, w = rgba.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(cw, x + w), min(ch, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    patch = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
    alpha = patch[:, :, 3:4].astype(np.float32) / 255.0
    canvas[y0:y1, x0:x1] = (
        patch[:, :, :3].astype(np.float32) * alpha +
        canvas[y0:y1, x0:x1].astype(np.float32) * (1 - alpha)
    ).astype(np.uint8)


def _paste_rgba(canvas, rgba, x, y):
    ch, cw = canvas.shape[:2]
    h, w = rgba.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(cw, x + w), min(ch, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    canvas[y0:y1, x0:x1] = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
