// license:BSD-3-Clause
// copyright-holders:Charles MacDonald
// Standalone adaptation; see README.md.
#pragma once
#include <cstdint>
using u8 = uint8_t; using u16 = uint16_t; using u32 = uint32_t;
using s16 = int16_t; using s32 = int32_t;
class Huc6280 {
public:
    Huc6280(uint32_t clock, uint32_t rate);
    void reset();
    void write(uint32_t offset, uint8_t data);
    void generate(float *left, float *right, uint32_t frames);
    void mute(uint32_t channel, bool muted) { if (channel < 6) m_muted[channel] = muted; }
    // Versioned little-endian core checkpoint; independent of C++ object layout.
    static constexpr uint32_t state_bytes = 512;
    bool save_state(uint8_t *data, uint32_t size) const;
    bool validate_state(const uint8_t *data, uint32_t size) const;
    bool load_state(const uint8_t *data, uint32_t size);
private:
    void tick(float &left, float &right);
    uint32_t m_clock, m_rate;
    uint64_t m_phase = 0;
    bool m_muted[6] = {};
    float m_left = 0, m_right = 0;
	struct channel {
		u16 frequency;
		u8 control;
		u8 balance;
		u8 waveform[32];
		u8 index;
		s16 dda;
		u8 noise_control;
		s32 noise_counter;
		u32 noise_frequency;
		u32 noise_seed;
		s32 tick;
	};
    struct decoded_state {
        uint64_t phase;
        float left, right;
        u8 select, enabled, balance, lfo_frequency, lfo_control, muted;
        channel channels[8];
    };
    bool decode_state(const uint8_t *data, uint32_t size, decoded_state &state) const;

	// internal state

	u8 m_select;
	u8 m_enabled;
	u8 m_balance;
	u8 m_lfo_frequency;
	u8 m_lfo_control;
	channel m_channel[8];
	s16 m_volume_table[32];
};
