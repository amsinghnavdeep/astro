"""Voice cloning with Coqui XTTS-v2.

Given a short reference recording of a real voice, synthesize the script in that
cloned voice. Mirrors tts.generate_voiceover: returns (combined_wav, meta) with
per-segment timing so captions line up.

The XTTS model is loaded lazily and cached (loading takes ~30s on CPU).
"""
import os
import re
import subprocess

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
os.environ.setdefault("COQUI_TOS_AGREED", "1")

MAX_GAP = 0.6
_MODEL = None

# XTTS's built-in Hindi tokenizer crashes on digits (num2words has no Hindi),
# so we spell numbers out in Hindi ourselves before synthesis.
_HI_ONES = ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
            "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह",
            "अठारह", "उन्नीस", "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस",
            "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस", "इकतीस",
            "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस",
            "उनतालीस", "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चौवालीस",
            "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास",
            "इक्यावन", "बावन", "तिरेपन", "चौवन", "पचपन", "छप्पन", "सत्तावन",
            "अट्ठावन", "उनसठ", "साठ", "इकसठ", "बासठ", "तिरेसठ", "चौंसठ",
            "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर", "इकहत्तर",
            "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर",
            "अठहत्तर", "उन्यासी", "अस्सी", "इक्यासी", "बयासी", "तिरासी",
            "चौरासी", "पचासी", "छियासी", "सत्तासी", "अठासी", "नवासी", "नब्बे",
            "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे",
            "सत्तानवे", "अट्ठानवे", "निन्यानवे"]


def _hi_below_thousand(n):
    out = []
    if n >= 100:
        out.append(_HI_ONES[n // 100] + " सौ")
        n %= 100
    if n:
        out.append(_HI_ONES[n])
    return " ".join(out)


def _num_to_hindi(n):
    if n == 0:
        return _HI_ONES[0]
    parts = []
    for div, name in ((10000000, "करोड़"), (100000, "लाख"), (1000, "हज़ार")):
        if n >= div:
            parts.append(_hi_below_thousand(n // div) + " " + name)
            n %= div
    if n:
        parts.append(_hi_below_thousand(n))
    return " ".join(parts)


def _normalize_numbers(text):
    """Replace currency + digit groups with spoken Hindi words."""
    text = text.replace("₹", " रुपये ").replace("$", " डॉलर ")

    def repl(m):
        digits = m.group(0).replace(",", "")
        if len(digits) > 9:  # beyond crores: read digit by digit
            return " ".join(_HI_ONES[int(d)] for d in digits)
        return _num_to_hindi(int(digits))

    # "रुपये 1,999" -> put amount before the unit word for natural Hindi
    text = re.sub(r"रुपये\s*([\d,]+)", lambda m: _num_to_hindi(int(m.group(1).replace(",", ""))) + " रुपये", text)
    text = re.sub(r"डॉलर\s*([\d,]+)", lambda m: _num_to_hindi(int(m.group(1).replace(",", ""))) + " डॉलर", text)
    text = re.sub(r"\d[\d,]*", repl, text)
    return re.sub(r"\s+", " ", text).strip()


def _get_model():
    global _MODEL
    if _MODEL is None:
        import torch
        from TTS.api import TTS
        torch.set_num_threads(max(1, (os.cpu_count() or 2)))
        _MODEL = TTS("tts_models/multilingual/multi-dataset/xtts_v2",
                     progress_bar=False).to("cpu")
    return _MODEL


def _dur(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True)
    return float(r.stdout.strip())


def generate_voiceover(segments, speaker_wav, workdir, language="hi"):
    """Clone `speaker_wav` and speak each segment; concat with silence gaps.

    Returns (combined_wav_path, meta) where meta is a list of
    {text, start, end, gap} in seconds.
    """
    os.makedirs(workdir, exist_ok=True)
    model = _get_model()

    seg_files = []
    for i, (seg_text, _gap) in enumerate(segments):
        p = os.path.join(workdir, f"vseg{i}.wav")
        text = _normalize_numbers(seg_text) if language == "hi" else seg_text
        model.tts_to_file(text=text, speaker_wav=speaker_wav,
                          language=language, file_path=p, split_sentences=True)
        seg_files.append(p)

    silence = os.path.join(workdir, "vsilence.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
         "-t", str(MAX_GAP), silence], capture_output=True)

    listf = os.path.join(workdir, "vconcat.txt")
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
                gclip = os.path.join(workdir, f"vgap{i}.wav")
                subprocess.run(
                    ["ffmpeg", "-y", "-i", silence, "-t", str(gap),
                     gclip], capture_output=True)
                f.write(f"file '{os.path.abspath(gclip)}'\n")
                clock += gap

    combined = os.path.join(workdir, "voiceover_clone.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listf,
         "-ar", "24000", "-ac", "1", combined], capture_output=True)
    return combined, meta
