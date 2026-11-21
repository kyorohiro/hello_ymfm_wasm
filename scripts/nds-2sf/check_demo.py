#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Measure two mini2SF tracks through the real SkyEmu renderer without audio output."""
import argparse
import json
import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

sys.dont_write_bytecode = True
from make_fixture import TRACKS, make_fixture

ROOT = Path(__file__).resolve().parents[2]
DEMO_DIR = ROOT / "build/nds-2sf/demo"
RENDERER = ROOT / "build/nds-2sf/render-skyemu"
ASSEMBLER = Path(__file__).with_name("assemble.mjs")


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or
                           f"{args[0]} exited with {result.returncode}")


def measure(path, side):
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        frames = wav.getnframes()
        if wav.getsampwidth() != 2 or wav.getnchannels() != 2 or frames < rate:
            raise RuntimeError(f"{path.name}: expected at least one second of stereo PCM16")
        # Let the machine boot, then measure the following half-second.
        wav.setpos(rate // 4)
        samples = list(struct.iter_unpack("<hh", wav.readframes(rate // 2)))

    absolute = [math.sqrt(sum((frame[ch] / 32768) ** 2 for frame in samples) / len(samples))
                for ch in range(2)]
    values = [frame[side] for frame in samples]
    mean = sum(values) / len(values)
    crossings = [index for index in range(1, len(values))
                 if values[index - 1] <= mean < values[index]]
    frequency = (rate * (len(crossings) - 1) / (crossings[-1] - crossings[0])
                 if len(crossings) >= 2 else 0)
    return rate, frames, absolute, frequency


def check(directory, renderer):
    make_fixture(directory)
    for entry, expected_hz, pan in TRACKS:
        source = directory / entry
        rom = source.with_suffix(".nds")
        wav = source.with_suffix(".wav")
        run("node", str(ASSEMBLER), str(source), str(rom))
        run(str(renderer.resolve()), str(rom), str(wav), "2")
        side = int(pan == 127)
        rate, frames, rms, measured_hz = measure(wav, side)
        if abs(measured_hz - expected_hz) > 3 or rms[side] < 0.01 or rms[1 - side] > rms[side] * 0.04:
            raise RuntimeError(
                f"{entry}: expected {expected_hz:.2f} Hz on {'LR'[side]}, "
                f"got {measured_hz:.2f} Hz, RMS L/R {rms}"
            )
        print(json.dumps({
            "track": entry, "sampleRate": rate, "frames": frames, "expectedHz": expected_hz,
            "measuredHz": round(measured_hz, 3), "rmsLeft": round(rms[0], 5),
            "rmsRight": round(rms[1], 5),
        }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, default=DEMO_DIR)
    parser.add_argument("--renderer", type=Path, default=RENDERER)
    options = parser.parse_args()
    if not options.renderer.is_file():
        parser.error("renderer is missing. Run sh scripts/nds-2sf/build_skyemu.sh")
    check(options.work_dir, options.renderer)
