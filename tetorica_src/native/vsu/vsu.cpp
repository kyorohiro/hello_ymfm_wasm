// SPDX-License-Identifier: BSD-3-Clause
#include "vsu.h"

namespace {
struct vsu_storage { void *address; };
}

// Native callers and the freestanding Wasm build both supply their own storage.
void *operator new(decltype(sizeof(0)), vsu_storage storage) noexcept {
    return storage.address;
}

namespace {

// Nintendo Virtual Boy Development Manual, revision C, section 6.
constexpr uint32_t clock_hz = 5000000;
constexpr uint32_t dac_period = 120;
constexpr uint32_t length_unit = 19200;
constexpr uint32_t envelope_unit = 76800;
constexpr uint32_t sweep_unit = 4800;
constexpr uint32_t wave_count = 5;
constexpr uint32_t channel_count = 6;
constexpr uint32_t all_channels = (1u << channel_count) - 1;
constexpr uint32_t wave_size = 32;
constexpr uint32_t noise_channel = 5;
constexpr uint32_t sweep_channel = 4;
constexpr uint32_t pitch_mask = 0x7ff;
constexpr uint16_t noise_seed = 0x7fff;
constexpr uint32_t mix_gain_bits = 8;
constexpr uint32_t mix_gain_one = 1u << mix_gain_bits;
constexpr uint32_t mix_output_shift = 3 + mix_gain_bits;

enum register_offset {
    interval_control = 0x00,
    stereo_level = 0x04,
    frequency_low = 0x08,
    frequency_high = 0x0c,
    envelope_control = 0x10,
    envelope_mode = 0x14,
    wave_select = 0x18,
    sweep_control = 0x1c,
};

struct channel {
    uint32_t oscillator_left = 0;
    uint32_t length_left = 0;
    uint32_t envelope_left = 0;
    uint16_t frequency = 0;
    uint16_t working_frequency = 0;
    uint8_t position = 0;
    uint8_t wave = 0;
    uint8_t stereo = 0;
    uint8_t envelope = 0;
    uint8_t envelope_settings = 0;
    uint8_t control = 0;
    uint8_t interval = 0;
    bool enabled = false;

    uint32_t envelope_period() const {
        return ((envelope_settings & 7) + 1) * envelope_unit;
    }

    void advance_envelope(uint32_t clocks) {
        if (!(control & 1))
            return;
        if (clocks < envelope_left) {
            envelope_left -= clocks;
            return;
        }
        envelope_left += envelope_period() - clocks;
        if (envelope_settings & 8) {
            if (envelope < 15) {
                ++envelope;
                return;
            }
        } else if (envelope > 0) {
            --envelope;
            return;
        }
        if (control & 2)
            envelope = envelope_settings >> 4;
    }
};

uint32_t volume(uint8_t side, uint8_t envelope) {
    const uint32_t product = side * envelope;
    return product ? (product >> 3) + 1 : 0;
}

struct dac_voice {
    uint16_t left = 0;
    uint16_t right = 0;
    uint16_t center_left = 0;
    uint16_t center_right = 0;
};

struct vsu {
    channel channels[channel_count];
    dac_voice held[channel_count];
    uint8_t waves[wave_count * wave_size];
    uint8_t modulation[wave_size];
    uint32_t dac_left = 0;
    uint32_t fraction = 0;
    uint32_t previous_rate = 0;
    uint32_t sweep_left = 0;
    uint16_t noise_shift = noise_seed;
    uint8_t noise_value = 63;
    uint8_t sweep = 0;
    uint8_t modulation_position = 0;
    uint8_t mix_mask = all_channels;
    uint16_t mix_gain[channel_count];
    int32_t held_left = 0;
    int32_t held_right = 0;

    vsu() {
        // Preserve a deterministic synth reset on freestanding builds as well.
        for (volatile uint8_t &value : waves)
            value = 0;
        for (volatile uint8_t &value : modulation)
            value = 0;
        for (uint16_t &gain : mix_gain)
            gain = mix_gain_one;
    }

    static uint32_t oscillator_period(const channel &voice, uint32_t index) {
        const uint32_t divisor = 2048 - voice.working_frequency;
        return index == noise_channel ? divisor * 10 : divisor;
    }

    uint32_t sweep_period(const channel &voice) const {
        if (!(voice.control & 0x40))
            return 0;
        return ((sweep >> 4) & 7) * (sweep & 0x80 ? 8 * sweep_unit : sweep_unit);
    }

    uint32_t get_channel(uint32_t index) const {
        if (index >= channel_count)
            return 0;
        const channel &voice = channels[index];
        uint32_t mode = 0;
        if (index == sweep_channel && sweep_period(voice))
            mode = voice.control & 0x10 ? 2 : 1;
        return voice.stereo | (voice.enabled ? 0x100 : 0) | (mode << 9);
    }

    uint32_t get_interval(uint32_t index) const {
        if (index >= channel_count || !(channels[index].interval & 0x20))
            return UINT32_MAX;
        return channels[index].interval & 0x1f;
    }

    bool snapshot_voice(uint32_t index, vsu_voice_snapshot &output, bool require_wave = true) const {
        if (index >= channel_count)
            return false;
        const channel &voice = channels[index];
        const bool has_wave = index != noise_channel;
        const bool valid_wave = has_wave && voice.wave < wave_count;
        const bool has_sweep = index == sweep_channel;
        if (require_wave && has_wave && !valid_wave)
            return false;

        output.frequency = voice.frequency;
        output.active = voice.enabled;
        output.wave_bank = has_wave ? voice.wave : UINT32_MAX;
        output.left = voice.stereo >> 4;
        output.right = voice.stereo & 15;
        output.ev0 = voice.envelope_settings;
        output.ev1 = voice.control;
        output.swp = has_sweep ? sweep : 0;
        for (uint32_t cell = 0; cell < wave_size; ++cell) {
            output.wave[cell] = valid_wave ? waves[voice.wave * wave_size + cell] : 0;
            output.modulation[cell] = has_sweep ? modulation[cell] : 0;
        }
        return true;
    }

    bool snapshot_live_voice(uint32_t index, vsu_live_voice_snapshot &output) const {
        if (!snapshot_voice(index, output.voice, false))
            return false;
        const channel &voice = channels[index];
        output.working_frequency = voice.working_frequency;
        output.current_envelope = voice.envelope;
        return true;
    }

    void reset_noise() {
        noise_shift = noise_seed;
        noise_value = 63;
    }

    void start(channel &voice, uint32_t index, uint8_t value) {
        voice.interval = value & 0x3f;
        voice.enabled = (value & 0x80) && (index == noise_channel || voice.wave < wave_count);
        if (!voice.enabled)
            return;
        voice.working_frequency = voice.frequency;
        voice.oscillator_left = oscillator_period(voice, index);
        voice.position = 0;
        voice.length_left = value & 0x20 ? ((value & 0x1f) + 1) * length_unit : 0;
        voice.envelope_left = voice.envelope_period();
        if (index == noise_channel)
            reset_noise();
        if (index == sweep_channel) {
            modulation_position = 0;
            sweep_left = sweep_period(voice);
        }
    }

    void write(uint32_t address, uint8_t value) {
        if (address & 3)
            return;
        if (address < 0x280) {
            for (const channel &voice : channels)
                if (voice.enabled)
                    return;
            waves[address / 4] = value & 63;
            return;
        }
        if (address < 0x300) {
            if (!channels[sweep_channel].enabled)
                modulation[(address - 0x280) / 4] = value;
            return;
        }
        if (address == 0x580 && (value & 1)) {
            for (channel &voice : channels)
                voice.enabled = false;
            return;
        }
        if (address < 0x400 || address >= 0x580)
            return;

        const uint32_t index = (address - 0x400) / 0x40;
        channel &voice = channels[index];
        switch (address & 0x3f) {
        case interval_control:
            start(voice, index, value);
            break;
        case stereo_level:
            voice.stereo = value;
            break;
        case frequency_low:
            voice.frequency = (voice.frequency & 0x700) | value;
            voice.working_frequency = (voice.working_frequency & 0x700) | value;
            break;
        case frequency_high: {
            const uint16_t high = static_cast<uint16_t>((value & 7) << 8);
            voice.frequency = (voice.frequency & 0xff) | high;
            voice.working_frequency = (voice.working_frequency & 0xff) | high;
            break;
        }
        case envelope_control:
            voice.envelope_settings = value;
            voice.envelope = value >> 4;
            voice.envelope_left = voice.envelope_period();
            break;
        case envelope_mode:
            voice.control = value;
            if (index == noise_channel)
                reset_noise();
            if (index == sweep_channel)
                sweep_left = sweep_period(voice);
            break;
        case wave_select:
            if (index != noise_channel) {
                voice.wave = value & 7;
                voice.position = 0;
                voice.oscillator_left = oscillator_period(voice, index);
                if (voice.wave >= wave_count)
                    voice.enabled = false;
            }
            break;
        case sweep_control:
            if (index == sweep_channel) {
                sweep = value;
                sweep_left = sweep_period(voice);
            }
            break;
        }
    }

    void advance_oscillator(channel &voice, uint32_t index, uint32_t clocks) {
        if (clocks < voice.oscillator_left) {
            voice.oscillator_left -= clocks;
            return;
        }
        const uint32_t rest = clocks - voice.oscillator_left;
        const uint32_t period = oscillator_period(voice, index);
        const uint32_t steps = 1 + rest / period;
        voice.oscillator_left = period - rest % period;
        if (index != noise_channel) {
            voice.position = (voice.position + steps) % wave_size;
            return;
        }

        // Section 6.4.17 gives the taps. Hardware captures by dasi and Guy
        // Perfect establish the inverted feedback output and initial state.
        constexpr uint8_t taps[] = {14, 10, 13, 4, 8, 6, 9, 11};
        const uint8_t tap = taps[(voice.control >> 4) & 7];
        for (uint32_t step = 0; step < steps; ++step) {
            const uint32_t feedback = ((noise_shift >> 7) ^ (noise_shift >> tap)) & 1;
            noise_shift = ((noise_shift << 1) | feedback) & noise_seed;
            noise_value = feedback ? 0 : 63;
        }
    }

    void modify_frequency(channel &voice) {
        if (voice.control & 0x10) {
            const int value = modulation[modulation_position++];
            const int offset = value < 128 ? value : value - 256;
            voice.working_frequency = static_cast<uint16_t>(voice.frequency + offset) & pitch_mask;
            if (modulation_position == wave_size) {
                modulation_position = 0;
                if (!(voice.control & 0x20))
                    sweep_left = 0;
            }
            return;
        }
        const uint32_t shift = voice.working_frequency >> (sweep & 7);
        const uint32_t next = sweep & 8 ? voice.working_frequency + shift : voice.working_frequency - shift;
        if (next > pitch_mask) {
            voice.enabled = false;
            return;
        }
        voice.working_frequency = static_cast<uint16_t>(next);
    }

    void advance(uint32_t clocks) {
        for (uint32_t index = 0; index < channel_count; ++index) {
            channel &voice = channels[index];
            if (!voice.enabled)
                continue;
            if (voice.length_left) {
                if (clocks >= voice.length_left) {
                    voice.enabled = false;
                    continue;
                }
                voice.length_left -= clocks;
            }
            voice.advance_envelope(clocks);
            if (index != sweep_channel || !sweep_left) {
                advance_oscillator(voice, index, clocks);
                continue;
            }
            if (clocks < sweep_left) {
                sweep_left -= clocks;
                advance_oscillator(voice, index, clocks);
                continue;
            }
            const uint32_t rest = clocks - sweep_left;
            advance_oscillator(voice, index, sweep_left);
            sweep_left = sweep_period(voice) - rest;
            modify_frequency(voice);
            if (voice.enabled && rest)
                advance_oscillator(voice, index, rest);
        }
    }

    void mix_held() {
        uint32_t left = 0, right = 0;
        uint32_t center_left = 0, center_right = 0;
        for (uint32_t index = 0; index < channel_count; ++index) {
            if (!(mix_mask & (1u << index)))
                continue;
            const uint32_t gain = mix_gain[index];
            left += held[index].left * gain;
            right += held[index].right * gain;
            center_left += held[index].center_left * gain;
            center_right += held[index].center_right * gain;
        }
        held_left = static_cast<int32_t>(left >> mix_output_shift) - static_cast<int32_t>(center_left >> mix_output_shift);
        held_right = static_cast<int32_t>(right >> mix_output_shift) - static_cast<int32_t>(center_right >> mix_output_shift);
    }

    void set_mix_mask(uint32_t mask) {
        mix_mask = mask & all_channels;
        // The new mix uses the current held DAC values, preserving DAC phase.
        mix_held();
    }

    void set_channel_gain(uint32_t index, float gain) {
        if (index >= channel_count || !(gain >= 0.0f && gain <= 1.0f))
            return;
        mix_gain[index] = static_cast<uint16_t>(gain * mix_gain_one + 0.5f);
        mix_held();
    }

    void sample_dac() {
        for (uint32_t index = 0; index < channel_count; ++index) {
            const channel &voice = channels[index];
            dac_voice &output = held[index];
            if (!voice.enabled) {
                output = {};
                continue;
            }
            const uint32_t sample = index == noise_channel ? noise_value : waves[voice.wave * wave_size + voice.position];
            const uint32_t gain_left = volume(voice.stereo >> 4, voice.envelope);
            const uint32_t gain_right = volume(voice.stereo & 15, voice.envelope);
            output.left = (sample * gain_left) >> 1;
            output.right = (sample * gain_right) >> 1;
            output.center_left = (63 * gain_left) >> 2;
            output.center_right = (63 * gain_right) >> 2;
        }
        mix_held();
        dac_left = dac_period;
    }

    void render(float *left, float *right, uint32_t frames, uint32_t rate) {
        // One host sample spans clock_hz time units; one VSU clock spans
        // rate units. Retain the remainder when the caller splits blocks.
        if (previous_rate && previous_rate != rate)
            fraction = static_cast<uint64_t>(fraction) * rate / previous_rate;
        previous_rate = rate;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            uint32_t sample_left = clock_hz;
            int64_t sum_left = 0, sum_right = 0;
            while (sample_left) {
                if (!dac_left)
                    sample_dac();
                const uint64_t until_dac = static_cast<uint64_t>(dac_left) * rate - fraction;
                const uint32_t span = until_dac < sample_left ? static_cast<uint32_t>(until_dac) : sample_left;
                sum_left += static_cast<int64_t>(held_left) * span;
                sum_right += static_cast<int64_t>(held_right) * span;
                const uint64_t time = static_cast<uint64_t>(fraction) + span;
                const uint32_t clocks = time / rate;
                fraction = time % rate;
                if (clocks)
                    advance(clocks);
                dac_left -= clocks;
                sample_left -= span;
            }
            constexpr double scale = 1.0 / (512.0 * clock_hz);
            left[frame] = static_cast<float>(sum_left * scale);
            right[frame] = static_cast<float>(sum_right * scale);
        }
    }
};

} // namespace

uint32_t vsu_size(void) {
    return sizeof(vsu);
}

void vsu_reset(void *state) {
    if (state)
        new (vsu_storage{state}) vsu;
}

void vsu_write(void *state, uint32_t offset, uint32_t value) {
    if (state)
        static_cast<vsu *>(state)->write(offset, static_cast<uint8_t>(value));
}

void vsu_set_mix_mask(void *state, uint32_t mask) {
    if (state)
        static_cast<vsu *>(state)->set_mix_mask(mask);
}

void vsu_set_channel_gain(void *state, uint32_t channel, float gain) {
    if (state)
        static_cast<vsu *>(state)->set_channel_gain(channel, gain);
}

uint32_t vsu_get_channel(const void *state, uint32_t channel) {
    return state ? static_cast<const vsu *>(state)->get_channel(channel) : 0;
}

uint32_t vsu_get_interval(const void *state, uint32_t channel) {
    return state ? static_cast<const vsu *>(state)->get_interval(channel) : UINT32_MAX;
}

uint32_t vsu_snapshot_size(void) {
    return sizeof(vsu_voice_snapshot);
}

uint32_t vsu_snapshot_voice(const void *state, uint32_t channel, vsu_voice_snapshot *output) {
    return state && output && static_cast<const vsu *>(state)->snapshot_voice(channel, *output);
}

uint32_t vsu_live_snapshot_size(void) {
    return sizeof(vsu_live_voice_snapshot);
}

uint32_t vsu_snapshot_live_voice(const void *state, uint32_t channel, vsu_live_voice_snapshot *output) {
    return state && output && static_cast<const vsu *>(state)->snapshot_live_voice(channel, *output);
}

void vsu_render(void *state, float *left, float *right, uint32_t frames, uint32_t sample_rate) {
    if (state && left && right && frames && sample_rate)
        static_cast<vsu *>(state)->render(left, right, frames, sample_rate);
}
