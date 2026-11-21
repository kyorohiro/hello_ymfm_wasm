#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Write an original ARM7 sound test and two mini2SF overlays that play it."""
import argparse
import math
import struct
import zlib
from pathlib import Path

ARM9_OFFSET = 0x4000
ARM9_ENTRY = 0x02004000
ARM7_OFFSET = 0x8000
ARM7_ENTRY = 0x03800000
PCM_OFFSET = 0x100
CYCLE_FRAMES = 32
TIMER_HZ = 33_513_982 / 2
TRACKS = (
    ("left-a4.mini2sf", 440.0, 0),
    ("right-e5.mini2sf", 659.255, 127),
)


def note_registers(frequency, pan):
    timer = 0x10000 - round(TIMER_HZ / (frequency * CYCLE_FRAMES))
    # Start, PCM16, loop, pan, volume. The upper timer word gives loop point 0.
    control = 0x80000000 | (1 << 29) | (1 << 27) | (pan << 16) | 100
    return struct.pack("<II", timer, control)


def make_rom(*, overwrite_sample=False):
    # Original ARM7 test program. LDR literals are patched below from their
    # positions. ARM9 idles while ARM7 sets up a looping sine on hardware CH0.
    code = [
        0,           # ldr r2, =0x04000304 (sound power)
        0xE3A01001,  # mov r1, #1
        0xE1C210B0,  # strh r1, [r2]
        0,           # ldr r2, =0x04000500 (master sound)
        0,           # ldr r1, =0x807f
        0xE1C210B0,  # strh r1, [r2]
        0,           # ldr r0, =0x04000400 (CH0 control base)
        0,           # ldr r1, =PCM address
        0xE5801004,  # str r1, [r0, #4] (source)
        0,           # ldr r1, =timer/loop
        0xE5801008,  # str r1, [r0, #8]
        0xE3A01010,  # mov r1, #16 (32 PCM16 frames in 16 words)
        0xE580100C,  # str r1, [r0, #12]
        0,           # ldr r1, =control
        0xE5801000,  # str r1, [r0]
        0xEAFFFFFE,  # b .
    ]
    literals = [
        (0, 2, 0x04000304), (3, 2, 0x04000500), (4, 1, 0x807F),
        (6, 0, 0x04000400), (7, 1, ARM7_ENTRY + PCM_OFFSET),
        (9, 1, 0), (13, 1, 0),
    ]
    if overwrite_sample:
        # Leave time for the decoder to loop over the initial bytes, then
        # rewrite the first PCM word without changing any channel register.
        end = len(code) - 1
        code[end:] = [
            0,           # ldr r3, =delay
            0xE2533001,  # subs r3, r3, #1
            0x1AFFFFFD,  # bne subs
            0,           # ldr r2, =PCM address
            0,           # ldr r1, =0x1234ABCD
            0xE5821000,  # str r1, [r2]
            0xEAFFFFFE,  # b .
        ]
        literals[5:5] = [
            (end, 3, 0x100000),
            (end + 3, 2, ARM7_ENTRY + PCM_OFFSET),
            (end + 4, 1, 0x1234ABCD),
        ]
    for instruction, register, value in literals:
        distance = (len(code) - instruction - 2) * 4  # ARM PC points two instructions ahead.
        code[instruction] = 0xE59F0000 | (register << 12) | distance
        code.append(value)
    patch_offset = ARM7_OFFSET + (len(code) - 2) * 4

    wave = [round(12000 * math.sin(2 * math.pi * i / CYCLE_FRAMES))
            for i in range(CYCLE_FRAMES)]
    rom = bytearray(128 * 1024)
    rom[0:12] = b"TETORICA2SF "
    rom[0x0C:0x10] = b"T2SF"
    rom[0x10:0x12] = b"00"
    struct.pack_into("<4I", rom, 0x20, ARM9_OFFSET, ARM9_ENTRY, ARM9_ENTRY, 4)
    struct.pack_into("<4I", rom, 0x30, ARM7_OFFSET, ARM7_ENTRY, ARM7_ENTRY, PCM_OFFSET + len(wave) * 2)
    struct.pack_into("<2I", rom, 0x80, len(rom), 0x4000)
    struct.pack_into("<I", rom, ARM9_OFFSET, 0xEAFFFFFE)  # ARM9: b .
    struct.pack_into(f"<{len(code)}I", rom, ARM7_OFFSET, *code)
    struct.pack_into(f"<{len(wave)}h", rom, ARM7_OFFSET + PCM_OFFSET, *wave)
    rom[patch_offset:patch_offset + 8] = note_registers(TRACKS[0][1], TRACKS[0][2])
    return rom, patch_offset


def write_2sf(path, offset, payload, tags=""):
    executable = struct.pack("<II", offset, len(payload)) + payload
    compressed = zlib.compress(executable)
    header = b"PSF\x24" + struct.pack("<III", 0, len(compressed), zlib.crc32(compressed))
    tag_bytes = f"[TAG]{tags}".encode() if tags else b""
    path.write_bytes(header + compressed + tag_bytes)


def make_fixture(directory):
    directory.mkdir(parents=True, exist_ok=True)
    rom, patch_offset = make_rom()
    write_2sf(directory / "demo.2sflib", 0, rom)
    for name, pitch, pan in TRACKS:
        write_2sf(directory / name, patch_offset, note_registers(pitch, pan),
                  f"_lib=demo.2sflib\ntitle={name.removesuffix('.mini2sf')}\nlength=2.0\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--history-fixture", action="store_true",
                        help="generate a ROM that rewrites its playing PCM buffers")
    args = parser.parse_args()
    if args.history_fixture:
        args.output.mkdir(parents=True, exist_ok=True)
        rom, _ = make_rom(overwrite_sample=True)
        (args.output / "history-overwrite.nds").write_bytes(rom)
    else:
        make_fixture(args.output)
