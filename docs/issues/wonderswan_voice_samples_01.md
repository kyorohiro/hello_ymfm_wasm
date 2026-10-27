# WonderSwan timed Voice PCM extraction

Date: 2026-10-27.

## Problem

Sample Explorer's Wave RAM previews differed substantially from the reported
song. For `04 Cat Song ~ Theme of UPA.vgz`, all six extracted wave definitions
were unused RAM candidates: none of their eleven observations had nonzero
hardware volume. Isolated audition nevertheless played them at A4 and volume
9/9. The song's actual CH2 Voice PCM was not being extracted.

Wave observation metadata could also remain stale when frequency, volume or
headphone output was changed after key-on without another RAM upload. A
same-time key-on followed by 220 Hz setup could therefore preview at the
fallback 440 Hz pitch.

## Changes

- Capture CH2 Voice PCM bytes and related register writes in original 44100-Hz
  source time, including live output/routing settings and gate/mode changes.
- Split at Voice disable, CH2 key-off, EOF or ten-second display windows. The
  boundaries describe captures, not recovered original samples/instruments.
- Preserve current registers, the last native-tick register snapshot and source
  phase. Preview restores the tick phase using at most two seconds of bounded
  pre-roll instead of replaying the entire earlier song.
- Provide a Voice PCM input graph, hardware-routed stereo preview, timed JSON
  and 44.1 kHz PCM WAV. Prior wavetable output and the outer playback Mixer are
  excluded. No fades, normalization or fixed-rate conversion alter the capture.
- Separate unplayed Wave RAM candidates in a collapsed group. Preserve their
  raw data and explicit isolated audition without calling them played sounds.
- Refresh Wave metadata at final same-time setup and subsequent setting
  changes. `usedInPlayback` / `audible` identify positive-duration intervals
  with the channel, headphone path and nonzero volume enabled. These fields
  do not measure the waveform's actual acoustic audibility or infer note ends.

The extractor bounds retained payload, temporary chunks/copy peaks and metadata
work at 64 MiB, with 100,000 capture intervals. Dense PCM never becomes one
JavaScript object per write. Equal-time order, repeated values, endpoint writes
and held tails are retained. Abort/error paths release the preview WASM core.

The Browser, public sample API, CLI, JSON/ZIP and WAV exporters use the same
capture definitions. Support text and CLI/package documentation are updated.
Cache revision: `wonderswan-voice-samples-1`.

## Reported song

The 95.954785-second song yields ten Voice PCM captures and six unplayed Wave
RAM candidates. All **1,151,160 PCM bytes** are preserved. Their concatenated
SHA256 matches the original 0x89 values:

`dde01930a60baf9da477565c7ed9561a4b43924b33fe6b3d435243ae1c1ebf52`.

Capture starts are 0, 441000, …, 3969000; the last duration is 262606 samples.
PCM byte counts are 119702, eight captures of 120000, and 71458. Retained
capture work is 8,068,366 bytes after completion; temporary staging is zero.

## Validation

The Analyzer suite passed **599 tests**, with one existing skipped test.
Independent real-WASM tests compare complete synthetic capture outputs against
direct source playback, including nonstandard clocks, odd start positions,
all unsigned byte values, live routes, gate/mode changes and the second
ten-second window with different current and held values. VGM DAC-stream
commands and following direct PCM writes are checked through the public API.

The final standalone ZIP passed Chromium 153 and WebKit 26.6 checks. Both
browsers found ten Voice captures / six unused RAM candidates. The first
22,050 frames/channel from capture 1 (source 0 seconds) and capture 2 (source
10 seconds) match independent original CH2 output exactly. Their PCM16 WAV
samples also match. JSON downloads equal their ZIP members; all ten captures'
PCM bytes and timestamps match an independent source walk. The existing Wave
graph/code/preview, stop and file-change cancellation checks also pass.

All 187 served files match the final ZIP; its 401 files match the staged
application. Docs functionality also passed both browsers, before the final
support-text correction. The final flat report is the authoritative current
frontend receipt. Analyzer Tauri imports this same 401-file frontend; its six
Python and four Node tests pass.

The local npm package is checked through an isolated offline install; its
full middle ten-second synthetic WAV matches public source rendering byte
for byte. API / CLI JSON, ZIP and WAV agree. The version remains 0.2.14 and
the package is not published. No music payload is added to the repository
or application distribution.

Detailed receipts and source hashes are preserved in
[wonderswan_voice_samples_01.json](wonderswan_voice_samples_01.json).
The development Analyzer ZIP is
`release/hello_ymfm_wasm_wonderswan-voice-dev_itch_vgm_analyzer.zip`, SHA256
`e9e43bbb75131ce853006062daca111c1c18a0621bdceb1d52da86ff89e29bd5`.
Browser captures are measured before a muted physical output; human listening
and original-hardware comparisons are not performed.

Packaging exposed stale calibration receipts from earlier JSDoc cache-URL
changes. Thirty actual measurements were repeated; all measured PCM and gain
results are unchanged. Strict source checks are retained. See
[the calibration receipt refresh](analyzer_mixer_calibration_refresh_02.md).

## Try it

Reload the updated Analyzer, load the VGM/VGZ, and choose **Samples → Analyze
samples**. Open a **Voice PCM capture** to preview or save its JSON/WAV.
Unplayed RAM candidates are listed separately below the captured output.

No npm publish, version change, commit, push, tag or CI dispatch is performed.
