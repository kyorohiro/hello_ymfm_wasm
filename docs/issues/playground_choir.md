Tetorica FM2612: Sonic Pi / FX / Choir Experiment Notes

Recent exploration of Sonic Pi suggests an important direction for Tetorica FM2612.

The goal is not to copy Sonic Pi or turn Tetorica into a generic live-coding synth.

The useful lesson is that much of Sonic Pi’s appealing / emotional sound comes from:

* effects
* time variation
* randomization
* simple musical helpers
* good default sound design
* sample + effect combinations

rather than from the raw synth alone.

1. Keep the YM2612 identity

Do not redesign the current YM2612 into a generic multi-output synth yet.

The real YM2612 has 6 channels internally mixed to stereo L/R.

Current conceptual signal path:

CH1..CH6
   ↓
YM2612 internal mix
   ↓
stereo L/R
   ↓
Web Audio FX

Per-channel post effects would require exposing internal channel stems or heavily modifying the YM2612 implementation.

A possible future experimental synth could expose:

CH1 L/R
CH2 L/R
...
CH6 L/R

but that should be considered a different / extended instrument, not normal YM2612 behavior.

Likewise, ideas such as 6 operators, 12 channels, and 24 outputs are interesting future possibilities, but they are not needed now.

For now, preserve the constraint:

4OP
6CH
stereo L/R

and make that constraint musically interesting.

⸻

2. Sonic Pi FX are a major part of its sound

Examples such as:

with_fx :wobble, phase: 2 do
  with_fx :echo, mix: 0.6 do
    ...
  end
end

sound impressive largely because of the effect chain.

Important effects worth exploring in Tetorica:

reverb
delay / echo
slicer
wobble
filter / filter sweep
chorus / ensemble

The current priority should probably be improving a small number of expressive FX rather than adding many more FM presets.

A strong FM preset plus a good effect chain is often more useful than a large preset library.

Do not add a generic amp abstraction to play() just to imitate Sonic Pi.

Prefer exposing YM2612-native controls where possible, for example operator TL.

⸻

3. Sample-based Sonic Pi sounds should not necessarily be recreated as samples

For example:

sample :ambi_choir

is fundamentally sample playback.

However, it may be interesting to recreate a similar perceptual role using:

YM2612
   ↓
chorus / ensemble
   ↓
low-pass filtering
   ↓
long reverb

The goal is not exact sample emulation.

The goal is:

Create a recognizable 1990s-style choir / ambient pad texture using only YM2612 synthesis plus Web Audio processing.

This could become a distinctive Tetorica demo.

⸻

4. CH3 Special Mode may be especially useful for choir-like textures

A promising experiment already exists:

fm.reset();
// YM2612 CH3 Special Mode
fm.setChannel3SpecialMode(true);
// ALG 7:
// OP1, OP2, OP3, OP4 are all carriers.
fm.setAlgo(CH3, 7, 0);
fm.setPan(CH3, true, true);
const op = {
  multi: 1,
  tl: 24,
  ar: 31,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
};
fm.setOperator(CH3, OP1, op);
fm.setOperator(CH3, OP2, op);
fm.setOperator(CH3, OP3, op);
fm.setOperator(CH3, OP4, op);
fm.setChannel3SpecialFrequency(OP1, 4, 512); // C-ish
fm.setChannel3SpecialFrequency(OP2, 4, 645); // E-ish
fm.setChannel3SpecialFrequency(OP3, 4, 768); // G-ish
fm.noteOn(CH3, 5, 512); // upper C-ish
await sleep(1.5);
fm.noteOff(CH3);
await sleep(0.3);
fm.setChannel3SpecialMode(false);

This already has a choir / ensemble-like character to the ear.

Why:

* ALG 7 makes all four operators carriers.
* CH3 Special Mode gives independent frequencies to OP1..OP4.
* The four operators can therefore behave like four simple voices inside one YM2612 channel.
* This is closer to additive layering than to strongly modulated FM.

Conceptually:

OP1 -> C-ish
OP2 -> E-ish
OP3 -> G-ish
OP4 -> upper C-ish

That gives a four-part chord-like texture inside CH3.

This may be a very useful Tetorica-specific technique.

⸻

5. Try making the CH3 Special Mode patch more choir-like

The current patch has a very fast attack:

ar: 31

which can make it feel more like an organ / synth pad.

For a softer choir-like texture, experiment with slower attacks and longer releases:

const op = {
  multi: 1,
  tl: 24,
  ar: 8,
  d1r: 4,
  d2r: 2,
  sl: 4,
  rr: 6,
};

Also avoid making all four operators identical.

For example, slightly vary TL:

OP1 TL 20
OP2 TL 26
OP3 TL 30
OP4 TL 22

Small differences in envelope and level may help remove the perfectly uniform synthetic quality.

Do not overcomplicate this initially.

Start from subtle variation.

⸻

6. Proposed choir processing chain

After the YM2612 stereo output, experiment with:

YM2612
  ↓
chorus / ensemble
  ↓
high-pass around 100-200 Hz
  ↓
low-pass around 3-6 kHz
  ↓
long reverb

The chorus / ensemble stage is likely important.

A simple Web Audio implementation can use multiple short modulated delays:

dry --------------------------\
                               +-> mix
delay ~12 ms, slowly modulated |
delay ~19 ms, slowly modulated /

Use small delay-time modulation and short gain ramps where needed to avoid clicks.

The purpose is not a flashy chorus effect.

The purpose is to create the impression of multiple slightly different voices.

⸻

7. Important design insight

The interesting direction is not:

Make YM2612 sound exactly like Sonic Pi.

The interesting direction is:

Keep the YM2612 hardware constraints visible, then use modern Web Audio effects and live-coding helpers to make those constraints musically expressive.

A potentially strong Tetorica demo would be:

“1990s-style ambient choir using YM2612 CH3 Special Mode + Web Audio chorus + reverb.”

That is more distinctive than simply adding sample playback.

No implementation is required from these notes unless explicitly requested later.

Treat this as design context for future Tetorica FM2612 work.