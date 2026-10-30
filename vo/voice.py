"""Voice a scene's narration with Kokoro.

Input:  narration.txt with optional {cue:name} markers placed directly before a word.
Output: vo.wav (24 kHz mono) and vo.words.json:
  { duration, lead, tail, voice, speed, text,
    words: [{ text, start, end }],   # seconds, absolute (lead silence included)
    cues:  { name: seconds } }       # start time of the first word after each marker
"""

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 24000
CUE = re.compile(r"\{cue:([A-Za-z0-9_\-]+)\}")
WORDLIKE = re.compile(r"[A-Za-z0-9]")


def strip_cues(raw: str):
    """Remove cue markers and collapse whitespace, keeping each cue's char offset in the clean text."""
    lines = [l for l in raw.splitlines() if not l.lstrip().startswith("#")]
    raw = " ".join(lines)
    text, cues, pos = [], [], 0
    for m in CUE.finditer(raw):
        text.append(raw[pos : m.start()])
        cues.append((m.group(1), len("".join(text))))
        pos = m.end()
    text.append(raw[pos:])
    joined = "".join(text)

    # Collapse whitespace while remapping cue offsets.
    out, remap, prev_space = [], [], False
    for ch in joined:
        remap.append(len(out))
        if ch.isspace():
            if not prev_space and out:
                out.append(" ")
            prev_space = True
        else:
            out.append(ch)
            prev_space = False
    remap.append(len(out))
    clean = "".join(out).rstrip()
    cues = [(name, min(remap[off], len(clean))) for name, off in cues]
    return clean, cues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("narration")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--lead", type=float, default=0.5, help="seconds of silence before speech")
    ap.add_argument("--tail", type=float, default=1.0, help="seconds of silence after speech")
    args = ap.parse_args()

    clean, cues = strip_cues(Path(args.narration).read_text())
    if not clean:
        sys.exit("narration is empty")

    from kokoro import KPipeline  # slow import; keep after arg parsing

    pipeline = KPipeline(lang_code=args.voice[0], repo_id="hexgrad/Kokoro-82M")
    parts = [np.zeros(int(args.lead * SR), dtype=np.float32)]
    words, offset, search_from = [], args.lead, 0
    for r in pipeline(clean, voice=args.voice, speed=args.speed, split_pattern=None):
        if r.audio is None:
            continue
        for t in r.tokens or []:
            if t.start_ts is None or t.end_ts is None:
                continue
            idx = clean.find(t.text, search_from)
            if idx >= 0:
                search_from = idx + len(t.text)
            words.append(
                {
                    "text": t.text,
                    "start": round(offset + t.start_ts, 3),
                    "end": round(offset + t.end_ts, 3),
                    "char": idx,
                }
            )
        audio = r.audio.detach().cpu().numpy().astype(np.float32)
        parts.append(audio)
        offset += len(audio) / SR
    parts.append(np.zeros(int(args.tail * SR), dtype=np.float32))
    audio = np.concatenate(parts)

    cue_times = {}
    for name, off in cues:
        hit = next((w for w in words if w["char"] >= off and WORDLIKE.search(w["text"])), None)
        if hit is None:
            sys.exit(f"cue '{name}' has no word after it")
        cue_times[name] = hit["start"]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sf.write(out / "vo.wav", audio, SR)
    (out / "vo.words.json").write_text(
        json.dumps(
            {
                "duration": round(len(audio) / SR, 3),
                "lead": args.lead,
                "tail": args.tail,
                "voice": args.voice,
                "speed": args.speed,
                "text": clean,
                "words": [{k: w[k] for k in ("text", "start", "end")} for w in words],
                "cues": cue_times,
            },
            indent=1,
        )
    )
    print(json.dumps({"duration": round(len(audio) / SR, 3), "words": len(words), "cues": cue_times}))


if __name__ == "__main__":
    main()
