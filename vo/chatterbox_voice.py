"""Voice a scene's narration with Chatterbox (run inside the Chatterbox venv; its torch pins clash with Kokoro's).

Same input and output as voice.py: narration.txt with {cue:name} markers → vo.wav + vo.words.json.

Chatterbox reports no word timings and is unreliable on long inputs, so the narration is voiced one sentence
at a time and each sentence is transcribed back with faster-whisper:
  - the transcript gives each word's start and end (script words are aligned to it; words Whisper writes
    differently, like "eighty-seven" → "87", get the time of the block they were heard in)
  - a sentence that comes back too different from the script (Chatterbox now and then skips, repeats or
    invents words) is regenerated with the next seed, up to --tries times, keeping the closest take
"""

import argparse
import difflib
import json
import re
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from voice import WORDLIKE, strip_cues  # noqa: E402

SENT_GAP = 0.22  # seconds between sentences in a paragraph
PARA_GAP = 0.5  # seconds between paragraphs (narration.txt lines)
FILLERS = {"uh", "um", "er", "erm", "ah", "hmm", "mm"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9']", "", s.lower())


def sentences(clean: str, para_starts: set[int]):
    """Split clean text into (start, end, text, gap_before), keeping abbreviations like "V.S." whole."""
    out, start = [], 0
    for m in re.finditer(r"(?<=[.?!])\s+", clean):
        prev = clean[start : m.start()].split()[-1]
        if re.fullmatch(r"(?:[A-Za-z]\.)+", prev):
            continue
        out.append((start, m.start()))
        start = m.end()
    out.append((start, len(clean)))
    return [(a, b, clean[a:b], 0 if k == 0 else PARA_GAP if a in para_starts else SENT_GAP) for k, (a, b) in enumerate(out)]


def trim(audio, sr, floor_db=-45):
    """Cut the near-silence Chatterbox pads both ends with."""
    win = int(sr * 0.01)
    rms = np.array([np.sqrt(np.mean(audio[i : i + win] ** 2)) for i in range(0, len(audio) - win, win)])
    loud = np.where(20 * np.log10(rms + 1e-9) > floor_db)[0]
    if not len(loud):
        return audio
    return audio[max(0, loud[0] * win - int(sr * 0.03)) : min(len(audio), (loud[-1] + 1) * win + int(sr * 0.08))]


def align(text: str, base: int, heard, offset: float):
    """Give every script word in `text` a start/end from the heard words; returns (words, similarity)."""
    script = [(m.group(), base + m.start()) for m in re.finditer(r"\S+", text)]
    sn = [norm(w) for w, _ in script]
    hn = [norm(w) for w, _, _ in heard]
    sm = difflib.SequenceMatcher(a=sn, b=hn, autojunk=False)
    times: list = [None] * len(script)
    for op, a1, a2, b1, b2 in sm.get_opcodes():
        if op == "equal":
            for i in range(a2 - a1):
                times[a1 + i] = (heard[b1 + i][1], heard[b1 + i][2])
        elif op == "replace":
            t0, t1 = heard[b1][1], heard[b2 - 1][2]
            weights = [max(1, len(sn[i])) for i in range(a1, a2)]
            acc = t0
            for i, wgt in zip(range(a1, a2), weights):
                d = (t1 - t0) * wgt / sum(weights)
                times[i] = (acc, acc + d)
                acc += d
    # Words Whisper didn't hear at all: squeeze them between their neighbours.
    for i, t in enumerate(times):
        if t is None:
            prev = next((times[j][1] for j in range(i - 1, -1, -1) if times[j]), 0.0)
            nxt = next((times[j][0] for j in range(i + 1, len(times)) if times[j]), prev)
            times[i] = (prev, max(prev, nxt))
    words = [{"text": w, "start": round(offset + a, 3), "end": round(offset + b, 3), "char": c} for (w, c), (a, b) in zip(script, times)]
    return words, sm.ratio(), [f"{op}: {' '.join(sn[a1:a2])!r} → {' '.join(hn[b1:b2])!r}" for op, a1, a2, b1, b2 in sm.get_opcodes() if op != "equal"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("narration")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--ref", default=None, help="reference clip to clone (default: Chatterbox's own voice)")
    ap.add_argument("--exaggeration", type=float, default=0.5)
    ap.add_argument("--cfg-weight", type=float, default=0.5)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--tries", type=int, default=3)
    ap.add_argument("--min-ratio", type=float, default=0.9, help="script/transcript similarity a take must reach")
    ap.add_argument("--lead", type=float, default=0.5)
    ap.add_argument("--tail", type=float, default=2.2, help="seconds of silence after speech (the last picture holds)")
    args = ap.parse_args()

    raw = Path(args.narration).read_text()
    clean, cues = strip_cues(raw)
    if not clean:
        sys.exit("narration is empty")
    para_starts, pos = set(), 0
    for line in raw.splitlines():
        if line.lstrip().startswith("#"):
            continue
        part = strip_cues(line)[0]
        if part:
            idx = clean.find(part, pos)
            if idx >= 0:
                para_starts.add(idx)
                pos = idx + len(part)

    import torch
    from chatterbox.tts import ChatterboxTTS
    from faster_whisper import WhisperModel

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    model = ChatterboxTTS.from_pretrained(device=device)
    whisper = WhisperModel("small.en", device="cpu", compute_type="int8")
    sr = model.sr
    ref = str(Path(args.ref).expanduser()) if args.ref else None

    parts = [np.zeros(int(args.lead * sr), dtype=np.float32)]
    words, offset, report = [], args.lead, []
    for a, b, text, gap in sentences(clean, para_starts):
        if gap:
            parts.append(np.zeros(int(gap * sr), dtype=np.float32))
            offset += gap
        best = None
        for k in range(args.tries):
            torch.manual_seed(args.seed + k)
            wav = model.generate(text, audio_prompt_path=ref, exaggeration=args.exaggeration, cfg_weight=args.cfg_weight)
            audio = trim(wav.squeeze(0).cpu().numpy().astype(np.float32), sr)
            segs, _ = whisper.transcribe(audio if sr == 16000 else _resample(audio, sr), language="en", word_timestamps=True, beam_size=5)
            heard = [(w.word.strip(), w.start, w.end) for s in segs for w in (s.words or []) if norm(w.word)]
            if not heard:
                continue
            ws, ratio, diff = align(text, a, heard, offset)
            # A filler the script doesn't have ("uh", "um") is a flawed take however close the rest is.
            fillers = {norm(w) for w, _, _ in heard} & FILLERS - {norm(w) for w in text.split()}
            if fillers:
                ratio = min(ratio, args.min_ratio - 0.01)
            if best is None or ratio > best[1]:
                best = (ws, ratio, diff, audio, k)
            if ratio >= args.min_ratio:
                break
        if best is None:
            sys.exit(f"no usable take for: {text}")
        ws, ratio, diff, audio, k = best
        words += ws
        parts.append(audio)
        offset += len(audio) / sr
        report.append({"text": text, "seed": args.seed + k, "ratio": round(ratio, 3), "diff": diff})
        print(f"  {ratio:.2f} seed {args.seed + k}  {len(audio) / sr:5.2f}s  {text}", file=sys.stderr, flush=True)
    parts.append(np.zeros(int(args.tail * sr), dtype=np.float32))
    audio = np.concatenate(parts)

    cue_times = {}
    for name, off in cues:
        hit = next((w for w in words if w["char"] >= off and WORDLIKE.search(w["text"])), None)
        if hit is None:
            sys.exit(f"cue '{name}' has no word after it")
        cue_times[name] = hit["start"]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sf.write(out / "vo.wav", audio, sr)
    (out / "vo.words.json").write_text(json.dumps({
        "duration": round(len(audio) / sr, 3), "lead": args.lead, "tail": args.tail,
        "engine": "chatterbox", "voice": ref or "default", "exaggeration": args.exaggeration, "cfgWeight": args.cfg_weight,
        "text": clean,
        "words": [{k: w[k] for k in ("text", "start", "end")} for w in words],
        "cues": cue_times,
        "takes": report,
    }, indent=1))
    print(json.dumps({"duration": round(len(audio) / sr, 3), "words": len(words), "cues": cue_times}))


def _resample(audio, sr, to=16000):
    """Linear resample for Whisper, which wants 16 kHz arrays."""
    n = int(len(audio) * to / sr)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


if __name__ == "__main__":
    main()
