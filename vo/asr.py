"""Voice graders for a narrated scene.

Transcribes vo.wav back with Whisper and compares it to the script and to Kokoro's own word timings:
  - wer: word error rate vs narration.txt (did it say it correctly?)
  - drift: |Kokoro start − Whisper start| per matched word (are the cue timestamps trustworthy?)
  - pacing: words per minute, longest internal pause, leading/trailing silence
Loudness is measured separately with ffmpeg (EBU R128).
"""

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

NORM = re.compile(r"[^a-z0-9' ]+")


def norm_words(text: str):
    return [w for w in NORM.sub(" ", text.lower().replace("’", "'")).split() if w]


def wer(ref, hyp):
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)] / max(1, len(ref))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene_dir")
    ap.add_argument("--model", default="base.en")
    ap.add_argument("--audio", default="vo.wav", help="file in the scene dir to transcribe (e.g. mix.wav: narration under the score)")
    a = ap.parse_args()
    sd = Path(a.scene_dir)
    words_file = json.loads((sd / "vo.words.json").read_text())
    script = words_file["text"]

    from faster_whisper import WhisperModel

    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    segs, _ = model.transcribe(str(sd / a.audio), word_timestamps=True, language="en", beam_size=5)
    hyp_words = []
    for s in segs:
        for w in s.words or []:
            t = norm_words(w.word)
            if t:
                hyp_words.append({"w": t[0], "start": w.start, "end": w.end})

    ref = norm_words(script)
    hyp = [h["w"] for h in hyp_words]
    err = wer(ref, hyp)

    # Timestamp drift: match Kokoro's spoken words to Whisper's by sequence alignment.
    kok = [w for w in words_file["words"] if re.search(r"[A-Za-z0-9]", w["text"])]
    kw = [norm_words(w["text"])[0] if norm_words(w["text"]) else "" for w in kok]
    sm = difflib.SequenceMatcher(a=kw, b=hyp, autojunk=False)
    drifts = []
    for blk in sm.get_matching_blocks():
        for i in range(blk.size):
            if blk.a + i == 0:
                continue  # Whisper habitually snaps the first word's start to 0; it isn't evidence about Kokoro.
            drifts.append(abs(kok[blk.a + i]["start"] - hyp_words[blk.b + i]["start"]))
    drifts.sort()

    first = hyp_words[0]["start"] if hyp_words else 0
    last = hyp_words[-1]["end"] if hyp_words else 0
    gaps = [hyp_words[i + 1]["start"] - hyp_words[i]["end"] for i in range(len(hyp_words) - 1)]
    speech = max(0.01, last - first)
    out = {
        "wer": round(err, 4),
        "refWords": len(ref),
        "hypWords": len(hyp),
        "transcript": " ".join(hyp),
        "diff": [
            {"op": op, "ref": " ".join(ref[i1:i2]), "hyp": " ".join(hyp[j1:j2])}
            for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False).get_opcodes()
            if op != "equal"
        ],
        "driftMeanMs": round(1000 * sum(drifts) / max(1, len(drifts))),
        "driftMedianMs": round(1000 * drifts[len(drifts) // 2]) if drifts else None,
        "driftP95Ms": round(1000 * drifts[int(0.95 * (len(drifts) - 1))]) if drifts else None,
        "driftMaxMs": round(1000 * drifts[-1]) if drifts else None,
        "matched": len(drifts),
        "wpm": round(len(hyp) / (speech / 60), 1),
        "longestPause": round(max(gaps), 2) if gaps else 0,
        # Silence from Kokoro's own timings (Whisper's edge timestamps are unreliable).
        "leadSilence": round(kok[0]["start"], 2) if kok else round(first, 2),
        "tailSilence": round(words_file["duration"] - (kok[-1]["end"] if kok else last), 2),
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
