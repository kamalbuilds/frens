#!/usr/bin/env python3
"""Narration that paces like a person: one clip per breath group, designed pauses,
room tone, and a Whisper check on every clip.

Runs on the Mac mini inside ~/tts/.venv (Chatterbox + mlx_whisper):

    python human_voice.py script.txt out_dir [--ref ~/tts/reference_clean.wav] [--seed 7]

Script format (one breath group per line; blank line = paragraph):

    Your AI agent tells you it deposited one hundred into a Morpho vault.
    ! Did it?                      <- '!' emphasis: more energy
    ~ (it says that every time)    <- '~' aside: flatter, a touch faster
    Then it went the long way. [+900]   <- explicit pause after, in ms

Writes out_dir/narration.wav (48 kHz mono, about -16 LUFS) and
out_dir/timings.json: per line {text, start, end} and Whisper word times,
so a video can cut and animate on the spoken word.
"""
import argparse
import json
import os
import pathlib
import random
import re
import subprocess
import tempfile

import numpy as np
import torch
import torchaudio

SR = 48000
PRONOUNCE = {  # spoken form -> written form; Chatterbox mangles these
    "AgentKit": "Agent Kit",
    "USDC": "U.S.D.C.",
    "AI": "A.I.",
    "MCP": "M.C.P.",
    "tx": "transaction",
    "aUSD": "A U S D",
    "perps": "perps",
    "PnL": "P.N.L.",
}
TURN_WORDS = ("so ", "then ", "but ", "and then ", "now ")


def parse(path):
    lines, para_break = [], False
    for raw in pathlib.Path(path).read_text().splitlines():
        s = raw.strip()
        if not s:
            para_break = True
            continue
        tone = "plain"
        if s.startswith("!"):
            tone, s = "emph", s[1:].strip()
        elif s.startswith("~"):
            tone, s = "aside", s[1:].strip()
        pause = None
        m = re.search(r"\[\+(\d+)\]\s*$", s)
        if m:
            pause, s = int(m.group(1)), s[: m.start()].strip()
        if lines and para_break:
            lines[-1]["para"] = True
        lines.append({"text": s, "tone": tone, "pause": pause, "para": False})
        para_break = False
    return lines


def spoken(text):
    out = text
    for k, v in PRONOUNCE.items():
        out = re.sub(rf"\b{re.escape(k)}\b", v, out)
    return out


def pause_after(line, nxt, rng):
    if line["pause"] is not None:
        return line["pause"] / 1000
    t = line["text"].rstrip()
    if line["para"]:
        base = 1.1
    elif t.endswith("?"):
        base = 0.75
    elif t.endswith((".", "!")):
        base = 0.62
    elif t.endswith((",", ";", ":")):
        base = 0.26
    else:
        base = 0.18
    if nxt and nxt["text"].lower().startswith(TURN_WORDS):
        base += 0.22  # a beat before a turn in the argument
    if line["tone"] == "emph":
        base += 0.15  # let an emphatic line land
    return base * rng.uniform(0.85, 1.18)


def trim(wav, sr, keep=0.04, floor_db=-42):
    x = wav.squeeze(0).numpy()
    win = int(sr * 0.02)
    env = np.array([np.sqrt(np.mean(x[i : i + win] ** 2) + 1e-12) for i in range(0, len(x), win)])
    db = 20 * np.log10(env + 1e-12)
    on = np.where(db > max(floor_db, db.max() - 38))[0]
    if len(on) == 0:
        return wav
    a = max(0, on[0] * win - int(sr * keep))
    b = min(len(x), (on[-1] + 1) * win + int(sr * keep))
    return torch.from_numpy(x[a:b].copy()).unsqueeze(0)


WHISPER = str(pathlib.Path.home() / ".local/bin/mlx_whisper")
WMODEL = "mlx-community/whisper-large-v3-turbo"


def transcribe(path, words=False):
    """mlx_whisper lives in its own pipx env, not ~/tts/.venv, so call the CLI."""
    with tempfile.TemporaryDirectory() as d:
        cmd = [WHISPER, str(path), "--model", WMODEL, "--language", "en",
               "--output-format", "json", "--output-dir", d]
        if words:
            cmd += ["--word-timestamps", "True"]
        env = {**os.environ, "PATH": "/opt/homebrew/bin:" + os.environ.get("PATH", "")}  # it needs ffmpeg
        r = subprocess.run(cmd, capture_output=True, text=True, env=env)
        out = pathlib.Path(d) / (pathlib.Path(path).stem + ".json")
        if not out.exists():  # the CLI can exit 0 without writing anything
            raise RuntimeError(f"whisper wrote nothing for {path}: {(r.stderr or r.stdout)[-300:]}")
        return json.loads(out.read_text())


NUMBERS = {"eighty-six": "86", "eighty six": "86", "ten thousand": "10000", "six": "6", "seven": "7", "eight": "8", "nine": "9", "one hundred": "100", "a hundred": "100", "zero": "0", "one": "1", "two": "2",
           "three": "3", "four": "4", "five": "5", "ten": "10"}


ALIASES = {"pubs": "perps", "purps": "perps", "aust": "a u s d", "frens": "friends", "fren": "friend", "perpl": "purple", "frens.": "friends", "ausd": "a u s d", "pnl": "p n l", "cy": "sy", "bo": "bow", "dee": "d", "mia": "mia"}


def words_of(s):
    s = s.lower()
    s = re.sub(r"(?<=\d),(?=\d)", "", s)
    for k, v in ALIASES.items():
        s = re.sub(rf"\b{k}\b", v, s)
    s = re.sub(r"\b([a-z])\.(?=[a-z]\.)", r"\1", s).replace(".", " ")  # a.i. -> ai, u.s.d.c. -> usdc
    for k, v in NUMBERS.items():
        s = re.sub(rf"\b{k}\b", v, s)
    return re.findall(r"[a-z0-9']+", s)


def wer(ref, hyp):
    r, h = words_of(ref), words_of(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))


def room_tone(n, rng):
    white = np.random.default_rng(rng.randint(0, 2**31)).standard_normal(n)
    pink = np.convolve(white, np.ones(64) / 64, mode="same")  # gentle low-passed hiss
    return pink / (np.abs(pink).max() + 1e-9) * 10 ** (-58 / 20)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("out")
    ap.add_argument("--ref", default=str(pathlib.Path.home() / "tts/reference_clean.wav"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--max-tries", type=int, default=4)
    ap.add_argument("--max-wer", type=float, default=0.12)
    ap.add_argument("--reuse", action="store_true",
                    help="keep existing clips whose line text is unchanged; regenerate only edited lines")
    a = ap.parse_args()

    from chatterbox.tts import ChatterboxTTS

    out = pathlib.Path(a.out)
    (out / "clips").mkdir(parents=True, exist_ok=True)
    rng = random.Random(a.seed)
    lines = parse(a.script)
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ChatterboxTTS.from_pretrained(device=dev)
    style = {"plain": (0.42, 0.5, 0.8), "emph": (0.65, 0.35, 0.85), "aside": (0.3, 0.55, 0.7)}

    clips = []
    for i, ln in enumerate(lines):
        ex, cfg, temp = style[ln["tone"]]
        meta = out / "clips" / f"{i:03d}.json"
        if a.reuse and meta.exists():
            m = json.loads(meta.read_text())
            if m["text"] == ln["text"] and m["tone"] == ln["tone"]:
                wav, _ = torchaudio.load(str(out / "clips" / f"{i:03d}.wav"))
                clips.append(wav.squeeze(0).numpy())
                ln["wer"], ln["heard"] = m["wer"], m["heard"]
                print(f"{i:03d} reused | {ln['text'][:60]}", flush=True)
                continue
        best = None
        for attempt in range(a.max_tries):
            torch.manual_seed(a.seed * 1000 + i * 17 + attempt)
            wav = model.generate(spoken(ln["text"]), audio_prompt_path=a.ref,
                                 exaggeration=ex, cfg_weight=cfg, temperature=temp)
            wav = torchaudio.functional.resample(wav.cpu(), model.sr, SR)
            wav = trim(wav, SR)
            p = out / "clips" / f"{i:03d}.wav"
            torchaudio.save(str(p), wav, SR)
            heard = transcribe(p)["text"]
            score = wer(spoken(ln["text"]), heard)
            if best is None or score < best[0]:
                best = (score, wav, heard)
            if score <= a.max_wer:
                break
        score, wav, heard = best
        torchaudio.save(str(out / "clips" / f"{i:03d}.wav"), wav, SR)
        clips.append(wav.squeeze(0).numpy())
        flag = "" if score <= a.max_wer else "  <-- CHECK"
        print(f"{i:03d} wer={score:.2f} tries={attempt + 1} | {ln['text'][:60]} | heard: {heard.strip()[:60]}{flag}", flush=True)
        ln["wer"], ln["heard"] = round(score, 3), heard.strip()
        meta.write_text(json.dumps({"text": ln["text"], "tone": ln["tone"], "wer": ln["wer"], "heard": ln["heard"]}))

    parts, timeline, t = [], [], 0.35
    parts.append(np.zeros(int(SR * 0.35)))
    for i, (ln, c) in enumerate(zip(lines, clips)):
        timeline.append({"i": i, "text": ln["text"], "tone": ln["tone"], "start": round(t, 3),
                         "end": round(t + len(c) / SR, 3), "wer": ln["wer"]})
        parts.append(c)
        t += len(c) / SR
        gap = pause_after(ln, lines[i + 1] if i + 1 < len(lines) else None, rng) if i + 1 < len(lines) else 0.6
        parts.append(np.zeros(int(SR * gap)))
        t += gap
    voice = np.concatenate(parts)
    rms = np.sqrt(np.mean(voice[np.abs(voice) > 1e-3] ** 2))
    voice = voice * (10 ** (-18 / 20) / (rms + 1e-9))  # speech RMS near -18 dBFS, about -16 LUFS
    peak = np.abs(voice).max()
    if peak > 0.95:
        voice *= 0.95 / peak
    mix = voice + room_tone(len(voice), rng)
    torchaudio.save(str(out / "narration.wav"), torch.from_numpy(mix.astype(np.float32)).unsqueeze(0), SR)

    words = transcribe(out / "narration.wav", words=True)
    wl = [{"w": w["word"].strip(), "start": round(w["start"], 3), "end": round(w["end"], 3)}
          for s in words["segments"] for w in s.get("words", [])]
    (out / "timings.json").write_text(json.dumps({"duration": round(len(mix) / SR, 3),
                                                  "lines": timeline, "words": wl}, indent=1))
    bad = [ln for ln in timeline if ln["wer"] > a.max_wer]
    print(f"DONE {len(mix) / SR:.1f}s, {len(lines)} lines, {len(bad)} over WER {a.max_wer}")


if __name__ == "__main__":
    main()
