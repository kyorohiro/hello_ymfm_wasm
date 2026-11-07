# Original RSID interrupt demo

`irq.sid` is a newly authored, ROM-independent RSID v2 program for PAL / 6581.
It sets CIA 1 Timer A to a 997-cycle period and installs its own RAM IRQ vector.
The actual CPU interrupt handler increments a RAM counter, changes the SID pulse
width, acknowledges the CIA and returns with `RTI`. It has no PSID play entry;
the player must execute the CPU and interrupt hardware continuously.

The tune selects the I/O-visible `$35` memory map. Its initialization returns to
the player's RAM caller, leaving the configured timer to drive the sound.
`fixture.mjs` is the complete readable BSD-3-Clause generator. Regenerate with
`createRsidFixture('cia-irq').bytes`; no game data, ROM dump or external package
is required. `provenance.json` records the exact generator and output hashes.

The generator also supplies small machine-interrupt regression programs and a
tokenized original BASIC test program. Synthetic ROM fixtures are kept only in
the repository tests and are not included here. User-supplied ROM files are
never included in the player or its source archive.
