# SNES software Looper — 2026-11-15

Added Keyboard Looper Start / Stop, Record / Space, Undo and Clear. The first take defines the period; overdubs retain independent stereo PCM and their recorded edits. Stop / Start, Stop all sound, Code mode and native output switching preserve completed layers. Project replacement and Clear discard layers; unfinished takes are cancelled on stop.

The silent AudioWorklet tap reads the live instrument before Master / song input. SPC songs and previous layers are excluded. Playback uses the existing AudioContext and pre-Master song input, so Master, monitor and Tauri's final output routing apply once. No second Menu, speaker route or native adapter is added. Event Rec and event JSON import / export remain excluded.

Limits: 16 layers, 120 seconds per take / period, 128 MiB retained PCM, minimum 0.05 second take. Release / Echo audio is captured for 0.25 seconds after finishing, folded over the cycle; longer tails are truncated. Remaining memory can shorten a take. Audio is session-only and is not saved in presets / Cassette or restored after reload.

Validation: 154 Node tests passed. Chromium / WebKit passed actual AudioWorklet capture and repeat, isolated overdubbing, Master-zero capture, retained buffers under edits, Stop / Undo / Code transitions, processor failure recovery, mobile layout and reload checks. Final ZIP also passed mocked Tauri Native PCM / Web route switching in both engines. Previous preview passed existing SPC and Code regression suites. Physical audio was muted; no human listening or CPAL device verification was performed.

See [verification receipt](verification_snes_looper_20261115.json). Review ZIP, screenshots, native-check harness and logs are in ignored `build/verification/snes-looper-20261115/`. No commit, push, version update, release or Tauri dist import was performed. Existing FM and Tauri checkout edits were preserved.
