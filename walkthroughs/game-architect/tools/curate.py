"""Cuts the captured conversation (conversation.json, real model output) down to the demo script.

Edits are limited to keeping a subset of each answer's sentences (with their drawings), plus any drawing
fixes in edit(). Every edit is listed below. Writes script.json (what plays) and lines.json (what's spoken).

    python3 tools/curate.py
"""
import json
import re
from pathlib import Path

here = Path(__file__).resolve().parent.parent
log = json.loads((here / "conversation.json").read_text())

# Which sentences of each answer to keep, by position in the captured answer (0 = the opener).
KEEP = [
    [0, 2, 3, 4],        # where to start (page "Space Shooter"): sentence 1 repeated the opener; its drawing is merged in below
    [0, 1, 2, 3, 5],     # Firebase or Supabase (page "Accounts"): drop "accounts won't prevent cheating"
    [0, 1, 2, 5],        # anti-cheat scores: drop the plausible-max rule and replay-verification details
    [0, 1, 2, 5],        # multiplayer (page "Multiplayer"): drop the prediction and keep-Firebase details
    [0, 1, 3, 6],        # the whole thing: drop the simulation, read-rules and hosting details
]

def edit(turn, seg_index, seg):
    if turn == 0 and seg_index == 0:
        # Sentence 1 ("Start with one playable screen...") repeated the opener; keep its drawing (and its page), as the
        # app does automatically when the overlap is higher.
        return {**seg, "cmds": seg["cmds"] + log[0]["segs"][1]["cmds"]}
    return seg

# Pronunciations Kokoro doesn't know, as inline phonemes (the panel shows the original words).
SPOKEN = {
    "PostgreSQL": "[Postgres](/pˈOstɡɹɛs/)", "Postgres": "[Postgres](/pˈOstɡɹɛs/)", "Supabase": "[Supabase](/sˈupəbˌAs/)",
    "Cloudflare": "[Cloudflare](/klˈWdflˌɛɹ/)", "Vite": "[Vite](/vˈit/)", "WebSockets": "web sockets", "WebSocket": "web socket",
    "leaderboards": "leader boards", "leaderboard": "leader board", "signups": "sign ups", "Firestore": "Fire store", "spacebar": "space bar", "realtime": "real time",
    "verified": "[verified](/vˈɛɹɪfˌId/)", "Colyseus": "[Colyseus](/kˌɒləsˈiəs/)",
}
def spoken(text):
    return re.sub(r"\b(" + "|".join(SPOKEN) + r")\b", lambda m: SPOKEN[m.group(1)], text)

script, lines = [], {}
for t, (turn, keep) in enumerate(zip(log, KEEP), 1):
    script.append({"key": f"you{t}", "say": turn["question"]})
    lines[f"you{t}"] = spoken(turn["question"])
    for n, i in enumerate(keep, 1):
        seg = edit(t - 1, i, turn["segs"][i])
        key = f"ai{t}_{n}"
        script.append({"key": key, "say": seg["say"], "cmds": seg["cmds"]})
        lines[key] = spoken(seg["say"])

(here / "script.json").write_text(json.dumps(script, indent=2))
(here / "lines.json").write_text(json.dumps(lines, indent=2))
for s in script:
    print(f"{s['key']:7} {s['say']}")
