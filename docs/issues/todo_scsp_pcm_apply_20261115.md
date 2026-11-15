# SCSP PCM waveform Apply usage confirmation

User report, 2026-11-15: editing the waveform still sounds like Sine after
the documented Apply / new-note sequence. Screenshot shows Auto, PCM mode,
the initial PCM 2 / 64-sample bank, and `Unapplied PCM draft` below the
enabled Apply button.

Resolved 2026-11-16: the user clarified that Apply had not been pressed.
The screenshot is the expected editable draft state. Use **Apply PCM to this
slot**, then play a new note. Sounding / releasing voices retain their old
PCM, as designed.

- [x] Confirm the user's actual Apply operation / status.
- [x] Check the real instrument layer independently: PCM / FM2 / FM4 / FM6
      with keyboard and Code (eight cases). Applied PCM bytes match RAM,
      held native continuation stays identical, and the next attack uses
      the replacement sample / address and produces a different output hash.
- [x] Stop further investigation after clarification. Application code and
      tests are unchanged; no browser or release work is needed.

Native audit uses no audio device. Temporary evidence:
`/private/tmp/tetorica-scsp-pcm-apply-audit-BA1AoB/summary.json`.
No publication. Any automatic-Apply UX change remains a separate decision.

## Apply button visibility — requested 2026-11-16

- [x] Highlight the Apply button in orange whenever it is enabled for an
      unapplied PCM / tuning edit. Keep the existing explicit-Apply behavior.
- [x] Return to normal styling after applying, and restore the highlight
      when an edit becomes pending again, including a restored CH draft.
- [x] Check the visible states in Chromium / WebKit with physical output
      muted. Keep this visual change local to SCSP Synth styling.

Implemented with the existing enabled / pending state in
`docs/synth-scsp/synth.css`; the shared editor and Apply timing are unchanged.
Chromium / WebKit passed initial normal color, pending Sine / Saw / drawing /
Root edits, normal after Apply, normal on an unedited CH, and orange after
returning to a saved unapplied Auto draft. No AudioContext was created.
Receipt: `/private/tmp/scsp-apply-orange.json`; screenshot:
`/private/tmp/scsp-apply-orange-webkit.png`. `git diff --check` passed.
