# JSNES APU

Source: https://github.com/bfirsh/jsnes
Revision: b8a45d088e922b6abcd87c4eb1b7237919e9d3d2
License: Apache-2.0 (LICENSE); contributors: AUTHORS.md.

Only src/papu/*.js and src/utils.js are used, under docs/js/nes_apu_vendor/.
No CPU, PPU, ROMs or browser UI are included.
Local changes: utils import paths flattened; output-only mute mask added before
nonlinear mixing. Engine adapter sets mono panning and the recorded VGM CPU clock. The PAL adapter supplies the noise/DMC period tables;
PAPU opts.pal selects PAL frame-counter step and wrap timing.
CPU IRQ/DMA callbacks are inert: VGM already records the timed CPU writes.
Current scope: NTSC / PAL / Dendy-clock NES APU, two pulse voices, triangle, noise and DMC; embedded
VGM C2 RAM uploads. FDS is implemented separately with fixNES; dual chips are not supported. Note extraction
is a separate write-driven approximation, not the engine's internal state.
