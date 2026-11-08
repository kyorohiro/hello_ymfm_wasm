#!/usr/bin/env python3
"""Make the small, marked Tetorica adaptation from the pinned original header."""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'third_party/chips-m6581/upstream/m6581.h'
TARGET = SOURCE.parent.parent / 'm6581.h'


def prepared():
    text = SOURCE.read_text()
    # Avoid rounding the chip/output rate ratio to 1/16th of a cycle. The
    # accumulator stays in integer Hz units, with the original averaging intact.
    replacements = [
        ('''static inline uint32_t _m6581_wavnone(m6581_voice_t* v) {
    if (v->wav_accum) {
        uint32_t sm = (v->wav_accum >> 12);
        v->wav_accum >>= 1;
        return sm;
    }
    else {
        return 0;
    }
}''', '''static inline uint32_t _m6581_wavnone(m6581_voice_t* v) {
    /* Tetorica: waveform selection does not stop or discharge oscillator phase.
       Retain a simple digital output-latch decay, not measured DAC hold timing. */
    return v->wav_output >> 1;
}'''),
        ('m6581_voice_t* v = &sid->voice[voice_index];\n\n    /* waveform generator */',
         'm6581_voice_t* v = &sid->voice[voice_index];\n    v->sync = false; /* Tetorica: TEST cannot retain a rising-edge pulse */\n\n    /* waveform generator */'),
        ('sid->sample_period = (desc->tick_hz * M6581_FIXEDPOINT_SCALE) / desc->sound_hz;',
         'sid->sample_period = desc->tick_hz; /* Tetorica: exact rational sample clock */'),
        ('sid->sample_counter -= M6581_FIXEDPOINT_SCALE;',
         'sid->sample_counter -= sid->sound_hz; /* Tetorica: exact rational sample clock */'),
        ('''static void _m6581_init_cutoff_table() {
    for (int i = 0; i < 2048; i++) {
        float x = i / 8.0f;
        float cf = -0.0156f * x * x + 48.473f * x - 45.074f;
        _m6581_cutoff_freq[i] = cf <= 0 ? 0 : cf;
    }
}''', '''static void _m6581_init_cutoff_table() {
#ifdef __cplusplus
    /* Tetorica: initialize the shared table once, with C++ thread-safe guards. */
    static const bool initialized = []() {
#endif
    for (int i = 0; i < 2048; i++) {
        float x = i / 8.0f;
        float cf = -0.0156f * x * x + 48.473f * x - 45.074f;
        _m6581_cutoff_freq[i] = cf <= 0 ? 0 : cf;
    }
#ifdef __cplusplus
        return true;
    }();
    (void)initialized;
#endif
}'''),
        ('return (sm >> 1) && (sm << 1);',
         'return (sm >> 1) & (sm << 1); /* Tetorica: bitwise combined waveform */'),
        ('if (((++v->env_cur_level) & 0xFF) == 0xFF) {',
         '''/* Tetorica: physical envelope is an 8-bit counter. */
                    v->env_cur_level = (v->env_cur_level + 1) & 0xFF;
                    if (v->env_cur_level == 0) {
                        v->env_state = M6581_ENV_FROZEN;
                    }
                    else if (v->env_cur_level == 0xFF) {'''),
        ('''    m6581_voice_t* v_sync = &sid->voice[(voice_index+2)%3];
    if (v->sync && (v_sync->ctrl & M6581_CTRL_SYNC)) {
        v_sync->wav_accum = 0;
    }''', '''    /* Tetorica: source 3 -> target 1 -> target 2 -> target 3.
       A simultaneously synchronized source must not reset its next target. */
    m6581_voice_t* source = &sid->voice[(voice_index+2)%3];
    m6581_voice_t* target = &sid->voice[(voice_index+1)%3];
    if (v->sync && (target->ctrl & M6581_CTRL_SYNC)
        && !((v->ctrl & M6581_CTRL_SYNC) && source->sync)) {
        target->wav_accum = 0;
    }'''),
    ]
    for old, new in replacements:
        if text.count(old) != 1:
            raise RuntimeError('Pinned SID source no longer matches the documented adaptation')
        text = text.replace(old, new)
    return ('/* Tetorica adaptation; see README.md and PATCHES.md. Original below. */\n' + text).encode()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = prepared()
    if args.check:
        if not TARGET.exists() or TARGET.read_bytes() != data:
            parser.error('SID adaptation differs; run python3 scripts/prepare_sid_core.py')
    else:
        TARGET.write_bytes(data)
