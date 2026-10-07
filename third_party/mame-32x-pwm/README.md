# MAME 32X PWM adaptation

Source revision: df862b468443b391b24405c322aea60695d1825e.
https://github.com/mamedev/mame/blob/df862b468443b391b24405c322aea60695d1825e/src/mame/shared/mega32x.cpp
Header: same revision, src/mame/shared/mega32x.h.
BSD-3-Clause; copyright David Haywood. Original files are in upstream/.

web/pwm32x.js adapts calculate_pwm_timer, pwm_w, pwm_r, handle_pwm_callback
and the three-entry FIFO. Full FIFO writes discard the oldest item. Control/cycle
writes restart an enabled timer and clear FIFOs; cycle zero means 4095.
Timer ticks every cycle-1 input clocks, consumes left then right, routes to DACs,
and holds the last output on underrun. Interrupt cadence is counted, not delivered
to an SH2 CPU. No CPUs, DMA requests, video or MAME scheduler are included.

Host differences: clocks advance synchronously with PCM rendering; output is the
duration-weighted average within each output frame. Timing uses exact input clocks
rather than MAME scheduler integer-Hz conversion. The 12-bit DAC is represented
by (value/2048-1), with MAME's 0.4 route gain by default. Output before the first
DAC write is silent. This does not model analog PWM filtering or claim hardware
accuracy. It intentionally differs from the old cycle-normalized SimplePwm and
its fallback routing. Browser/Node code can select the experimental model for
comparison. Analyzer/CLI default VGM playback uses this FIFO/timer adapter
with cycle-normalized amplitude after a user-confirmed real-track comparison.
Real-hardware equivalence remains unverified.

VGM comparison adapter uses outputMode: duty, gain 1, i.e. value/cycle*2-1,
to match legacy PCM amplitude and FM/PSG balance. This host normalization is
not MAME's fixed DAC output. Raw outputMode: dac remains the standalone default.
VGM callers select it with pwmOutputMode: dac.
