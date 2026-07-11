"""Compose the talking-head clip into a 9:16 reel with blurred bg + captions."""
import os
import subprocess


def _dur(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip())


def compose_reel(talking_video, bg_image, ass_file, out_path, fps=25,
                 card_width=1040, frame_color="0xD4AF37"):
    """Overlay the talking head (gold-framed) on a blurred, gently-zooming
    background made from the avatar photo, add a dark caption strip + captions."""
    dur = _dur(talking_video)
    frames = int(dur * fps) + 5
    filtergraph = (
        f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
        f"crop=1080:1920,boxblur=18:2,eq=brightness=-0.22:saturation=1.12,"
        f"zoompan=z='min(zoom+0.00016,1.12)':d={frames}:s=1080x1920:fps={fps}[bg];"
        f"[1:v]scale={card_width}:-1:flags=lanczos,"
        f"pad=iw+16:ih+16:8:8:color={frame_color}[fg];"
        f"[bg][fg]overlay=x=(W-w)/2:y=210:shortest=1[cmp];"
        f"[cmp]drawbox=x=0:y=1250:w=1080:h=670:color=black@0.55:t=fill[strip];"
    )
    if ass_file:
        # ass filter needs escaped path
        ass_esc = ass_file.replace("\\", "\\\\").replace(":", "\\:")
        filtergraph += f"[strip]ass={ass_esc}[v]"
    else:
        filtergraph += "[strip]null[v]"

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-t", str(dur), "-i", bg_image,
        "-i", talking_video,
        "-filter_complex", filtergraph,
        "-map", "[v]", "-map", "1:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium",
        "-crf", "20", "-c:a", "aac", "-b:a", "192k",
        "-t", str(dur), "-r", str(fps), out_path,
    ]
    subprocess.run(cmd, check=True)
    return out_path
