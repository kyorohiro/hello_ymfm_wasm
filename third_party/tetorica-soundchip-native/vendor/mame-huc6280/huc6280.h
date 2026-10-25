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

	// internal state

	u8 m_select;
	u8 m_enabled;
	u8 m_balance;
	u8 m_lfo_frequency;
	u8 m_lfo_control;
	channel m_channel[8];
	s16 m_volume_table[32];
};
