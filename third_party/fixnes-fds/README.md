# fixNES FDS adaptation

Source: https://github.com/FIX94/fixNES
Pinned revision: 156fcaca9f4cd9c23d423737994c45cfb05d16ca
File: audio_fds.c
Copyright (C) 2017-2020 FIX94. License: MIT (LICENSE, also stated in the source header).

`docs/js/fds_audio.js` is a JavaScript adaptation of the pinned implementation.
It retains the divide-by-16 master clock, modulation accumulator and force bit,
envelope timers and wave/master volume behavior. CPU/memory mapper integration,
read-back registers and NSF loading are omitted. The VGM adapter maps register
addresses and handles 4023 write enable. The host adds a 2 kHz low-pass, DC
removal and approximate APU mix gain. Analog balance is not calibrated.

The previous NSFPlay-derived implementation and its notices have been removed;
this is a replacement port, not a relicensing of that implementation.

Validation: 10,000 CPU cycles of deterministic register/wave writes compared
against a native build of the pinned C file: master/modulation accumulators,
modulation index/counter, volume/sweep envelopes, divider and raw output match.
Hardware analog output and real-game listening remain unverified.
