"""Build a styled .ass subtitle file from segment timing, auto-chunking text."""
import os
import re

MAX_CHARS = 34  # per caption line


def _chunk(text):
    """Split a segment into short caption lines on punctuation / length."""
    text = re.sub(r"\s+", " ", text).strip()
    # split on sentence/clause punctuation but keep it readable
    pieces = re.split(r"(?<=[।!?.:,—-])\s+", text)
    lines = []
    for p in pieces:
        p = p.strip()
        if not p:
            continue
        while len(p) > MAX_CHARS:
            cut = p.rfind(" ", 0, MAX_CHARS)
            if cut <= 0:
                cut = MAX_CHARS
            lines.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            lines.append(p)
    return lines or [text]


def _ts(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,{font},64,&H00FFFFFF,&H000000FF,&H00202020,&H96000000,1,0,0,0,100,100,0,0,1,5,3,2,80,80,300,1
Style: Hi,{font},74,&H0000E5FF,&H000000FF,&H00101010,&H96000000,1,0,0,0,100,100,0,0,1,6,3,2,80,80,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

# lines matching these get the highlight (₹, $, prices, CTA words) style
HILITE_RE = re.compile(r"(₹|\$|book|बुक|link|लिंक|bio|बायो)", re.IGNORECASE)


def build_ass(meta, out_path, font="Noto Sans Devanagari"):
    events = []
    for seg in meta:
        lines = _chunk(seg["text"])
        total_chars = sum(len(l) for l in lines) or 1
        span = seg["end"] - seg["start"]
        t = seg["start"]
        for line in lines:
            share = span * (len(line) / total_chars)
            style = "Hi" if HILITE_RE.search(line) else "Base"
            events.append((t, t + share, style, line))
            t += share
    with open(out_path, "w") as f:
        f.write(ASS_HEADER.format(font=font))
        for start, end, style, text in events:
            text = text.replace("\n", " ")
            f.write(f"Dialogue: 0,{_ts(start)},{_ts(end)},{style},,0,0,0,,{text}\n")
    return out_path
