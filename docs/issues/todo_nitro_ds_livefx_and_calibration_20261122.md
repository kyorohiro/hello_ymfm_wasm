# Nitro DS liveFx, WonderSwan examples and calibration recovery

- [x] Preserve the prior 84-failure inventory as the audit baseline and review the calibration receipt chain in Git.
- [x] Update the WonderSwan Playground starter and examples to acquire their chip explicitly. Register the previous starter so that **Start with initial code** recognizes it as bundled code.
- [x] Verify the WonderSwan examples in the Playground and its browser ZIP.
- [x] Connect Code `liveFx()` to the existing Nitro DS Synth output. Verify the editor API, completion, effect lifecycle and both browser and desktop packaging.
- [x] Reproduce each of the 84 calibration failures. Restore the reviewed inputs for historical tests and keep rejection checks for unrelated source edits.
- [x] Re-run the calibration suite and affected Synth tests. Record the causes, verification and any remaining limitations here.

## Calibration audit

The baseline run of `node --test scripts/mixer_calibration*test.mjs` reported 228 passes and 84 failures. These are the test files that failed in that run. The count for AY timed and Code note includes one module startup failure each.

| Test files under `scripts/mixer_calibration_` | Baseline failures | Cause and correction |
| --- | ---: | --- |
| `scsp_dsp_delay_revision`, `scsp_dsp_execution_revision`, `scsp_dsp_helpers_revision`, `scsp_dsp_routing_revision`, `scsp_dsp_ui_revision` | 5 + 4 + 6 + 3 + 1 | The archived readers mixed changed Playground catalog, UI and SCSP helper sources into the old DSP proof chain. The test reader supplies the matching sources from `68caf4b8`. |
| `scsp_live_highlight_revision`, `scsp_loop_link_revision`, `scsp_output_level_new_cassette_revision` | 1 + 5 + 1 | Earlier chained proofs saw later Playground and timed-client bytes. Import and dependency reads use the archived sources, and the loop-link checks still compare the register and PCM outputs. |
| `playground_scsp_cycle2_examples_revision` | 1 | The nested routing proof received later catalog and Playground bytes. Check the original SCSP and catalog inputs in the historical reader. |
| `aswan_navigation_revision`, `scsp_navigation_revision`, `huc6280_ui_revision`, `wonderswan_host_budget_revision` | 4 + 3 + 3 + 2 | These cases read shared Monaco, preparation and renderer dependencies across successive revisions. Run each proof with its reviewed source files and retain later-source rejection checks. ASWAN CI fetches history for those inputs. |
| `ay_single_output_ui_cache_revision`, `ay_timed_revision`, `code_note_revision`, `log_table_cache_revision`, `monaco_model_revision` | 2 + 1 + 1 + 4 + 2 | Historical wrappers used later state, cache-token and model sources. Use the Git revisions reviewed by those receipts and keep mutation checks. |
| `ps1_import_revision`, `ps1_starter`, `sid_revision`, `vab_api_revision` | 3 + 1 + 4 + 4 | Later AY output and other source changes invalidated earlier proof inputs. Reproduce the historical chain at its reviewed revisions and verify that a real AY WASM change still requires new evidence. |
| `virtual_files_revision`, `virtual_files_workspace_revision` | 1 + 1 | The proofs read newer Shell/workspace and audio producers. Use the reviewed UI/Files revisions and retain the changed SCSP source rejection check. |
| `fm2608_navigation_revision`, `nes_navigation_revision`, `synth_source_navigation_revision` | 2 + 3 + 2 | Later viewer mappings were used as inputs for earlier link insertions. Recreate the exact source pairs, including the NES receipt generator, with the reviewed Git bytes. |
| `rf5c164_note_revision`, `ym2612_export_revision` | 2 + 4 | Later timed operations and import edits obscured the original note and class-export source pairs. Use the Git sources for the original pairs and continue checking unknown bytes and PCM equality. |
| `ym2413_state_revision`, `ym2608_output_gain_revision`, `ym2608_source_mix_history`, `ym2612_timed_revision` | 1 + 3 + 1 + 3 | Old checkpoints and gain/timed-API proofs received later mixer policy, synthesizer wrappers or runtime sources. Use each reviewed commit and keep the related source, PCM witness and report integrity checks. |
| **Total** | **84** | |

The calibration changes address the test inputs. Audio engines, historical PCM measurements and their recorded hashes are preserved. The production Playground packaging guard also authenticates the exact before/after bytes for the four WonderSwan example edits and the starter history test. Altering other source still invalidates the relevant proof.

The final calibration run passed all **319 tests**, with zero failures or skips. The increase from 312 reflects tests inside the two repaired modules that previously failed during startup, plus the WonderSwan catalog test. The Synth and Playground suite initially passed 5,712 cases. Its sole failure was the list of modes with starter history, which now includes WonderSwan and passed the focused rerun.

## Browser and Tauri verification

- The shipped WonderSwan starter rendered PCM in the Playground `_for_run.zip` in Chromium and WebKit, using both Main and Worker. Unit tests ran all three changed examples without an injected `ws` global.
- Nitro DS passed the full muted Chromium and WebKit browser checks, including 2SF, Sound Capture and timed operations. Stereo gain and pitch measurements verified the dry/wet transitions and confirmed that Stop preserves a held keyboard note.
- The exact Nitro DS ZIP imported into an isolated Tauri checkout, passed its five importer tests and built as a macOS arm64 application. The same 123 input files were verified in a Tauri/Wry WKWebView test build on `tauri://localhost`, using a temporary meter on the muted audio output. The measured gains were 0.249 and 0.496 for custom effects, 0.992 after clearing the effect on Apply, and 0.500 for native Gain. The original PCM pitch and pan were preserved.
- The Nitro DS ZIP carries the shared BSD-3-Clause software effect sources, build recipe and license. The packaged SkyEmu WASM matched the served file byte for byte.
