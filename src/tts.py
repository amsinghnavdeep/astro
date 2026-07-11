"""Hindi (or any edge-tts language) voiceover generation with per-segment timing."""
import asyncio
import os
import re
import subprocess

import edge_tts

# A "[N sec]" marker in the script means: end the current segment and pause N
# seconds (capped) before the next one. If no markers exist, blank lines split
# segments with a default gap.
PAUSE_RE = re.compile(r"\[\s*(\d+(?:\.\d+)?)\s*sec\s*\]", re.IGNORECASE)
MAX_GAP = 0.6
DEFAULT_GAP = 0.35


def parse_script(text):
    """Return list of (segment_text, gap_after_seconds)."""
    text = text.strip()
    if PAUSE_RE.search(text):
        segments = []
        pos = 0
        for m in PAUSE_RE.finditer(text):
            seg = text[pos:m.start()].strip()
            gap = min(float(m.group(1)), MAX_GAP)
            if seg:
                segments.append((seg, gap))
            pos = m.end()
        tail = text[pos:].strip()
        if tail:
            segments.append((tail, DEFAULT_GAP))
        return segments
    # fall back to blank-line separated paragraphs
    parts = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return [(p, DEFAULT_GAP) for p in parts]


async def _synth(segment_text, voice, rate, pitch, out_path):
    comm = edge_tts.Communicate(segment_text, voice, rate=rate, pitch=pitch)
    with open(out_path, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])


def _dur(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True)
    return float(r.stdout.strip())


def generate_voiceover(segments, voice, workdir, rate="-4%", pitch="-2Hz"):
    """Generate one mp3 per segment, concatenate with silence gaps.

    Returns (combined_mp3_path, meta) where meta is a list of dicts:
    {text, start, end, gap} in seconds (start/end are speech bounds).
    """
    os.makedirs(workdir, exist_ok=True)
    seg_files = []
    for i, (seg_text, _gap) in enumerate(segments):
        p = os.path.join(workdir, f"seg{i}.mp3")
        asyncio.run(_synth(seg_text, voice, rate, pitch, p))
        seg_files.append(p)

    # make a silence clip for gaps
    silence = os.path.join(workdir, "silence.mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
         "-t", str(MAX_GAP), silence],
        capture_output=True)

    # build concat list
    listf = os.path.join(workdir, "concat.txt")
    meta = []
    clock = 0.0
    with open(listf, "w") as f:
        for i, (seg_text, gap) in enumerate(segments):
            d = _dur(seg_files[i])
            meta.append({"text": seg_text, "start": clock,
                         "end": clock + d, "gap": gap})
            f.write(f"file '{os.path.abspath(seg_files[i])}'\n")
            clock += d
            if i < len(segments) - 1:
                # trim silence clip to the desired gap
                gclip = os.path.join(workdir, f"gap{i}.mp3")
                subprocess.run(
                    ["ffmpeg", "-y", "-i", silence, "-t", str(gap),
                     "-c", "copy", gclip], capture_output=True)
                f.write(f"file '{os.path.abspath(gclip)}'\n")
                clock += gap

    combined = os.path.join(workdir, "voiceover.mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listf,
         "-c", "copy", combined], capture_output=True)
    return combined, meta
