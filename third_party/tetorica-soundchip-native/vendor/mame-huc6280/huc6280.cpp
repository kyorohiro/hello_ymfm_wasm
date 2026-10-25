// license:BSD-3-Clause
// copyright-holders:Charles MacDonald
// Audio tick and register logic adapted from MAME c6280.cpp; see README.md.
#include "huc6280.h"
#include <cmath>
#include <cstring>
#define BIT(value, bit) ((uint32_t(value) >> (bit)) & 1U)
Huc6280::Huc6280(uint32_t clock, uint32_t rate) : m_clock(clock), m_rate(rate) {
    double level = 65535.0 / 6.0 / 32.0;
    for (int i = 0; i < 31; ++i) {
        m_volume_table[i] = (u16)level;
        level /= std::pow(10.0, (48.0 / 32.0) / 20.0);
    }
    m_volume_table[31] = 0;
    reset();
}
void Huc6280::reset() {
    m_select = m_enabled = m_balance = m_lfo_frequency = m_lfo_control = 0;
    std::memset(m_channel, 0, sizeof(m_channel));
    m_channel[4].noise_seed = m_channel[5].noise_seed = 1;
    m_phase = 0; m_left = m_right = 0;
}
// Average chip-clock samples into each output frame. Integer phase survives
// chunk boundaries, so writes, pause/resume and offline rendering agree.
void Huc6280::generate(float *left, float *right, uint32_t frames) {
    for (uint32_t i = 0; i < frames; ++i) {
        m_phase += m_clock;
        const uint32_t count = m_phase / m_rate;
        m_phase %= m_rate;
        double l = 0, r = 0;
        for (uint32_t j = 0; j < count; ++j) {
            tick(m_left, m_right); l += m_left; r += m_right;
        }
        left[i] = count ? l / count : m_left;
        right[i] = count ? r / count : m_right;
    }
}
void Huc6280::tick(float &left, float &right)
{
	// Fast method if none of the channels are enabled (most Data East arcade games)
	if (!(m_enabled & 0x3f)) { left = right = 0; return; }

	static const u8 scale_tab[16] =
	{
		0x00, 0x03, 0x05, 0x07, 0x09, 0x0b, 0x0d, 0x0f,
		0x10, 0x13, 0x15, 0x17, 0x19, 0x1b, 0x1d, 0x1f
	};

	const u8 lmal = scale_tab[(m_balance >> 4) & 0x0f];
	const u8 rmal = scale_tab[(m_balance >> 0) & 0x0f];

	for (int i = 0; i < 1; i++)
	{
		s32 lout = 0, rout = 0;
		for (int ch = 0; ch < 6; ch++)
		{
			// Only look at enabled channels
			if (BIT(m_enabled, ch))
			{
				channel &chan = m_channel[ch];

				const u8 lal = scale_tab[(chan.balance >> 4) & 0x0f];
				const u8 ral = scale_tab[(chan.balance >> 0) & 0x0f];
				const u8 al  = chan.control & 0x1f;

				// Verified from both patent and manual
				int vll = (0x1f - lmal) + (0x1f - al) + (0x1f - lal);
				if (vll > 0x1f) vll = 0x1f;

				int vlr = (0x1f - rmal) + (0x1f - al) + (0x1f - ral);
				if (vlr > 0x1f) vlr = 0x1f;

				vll = m_muted[ch] ? 0 : m_volume_table[vll];
				vlr = m_muted[ch] ? 0 : m_volume_table[vlr];

				// Check channel mode
				if ((ch >= 4) && BIT(chan.noise_control, 7))
				{
					// Noise mode
					const u32 step = (chan.noise_control & 0x1f) ^ 0x1f;
					const s16 data = BIT(chan.noise_seed, 0) ? 0x1f : 0;
					chan.noise_counter--;
					if (chan.noise_counter <= 0)
					{
						chan.noise_counter = step << 6; // 32 * 2
						const u32 seed = chan.noise_seed;
						// based on Charles MacDonald's research
						chan.noise_seed = (seed >> 1) | ((BIT(seed, 0) ^ BIT(seed, 1) ^ BIT(seed, 11) ^ BIT(seed, 12) ^ BIT(seed, 17)) << 17);
					}
					lout += vll * (data - 16);
					rout += vlr * (data - 16);
				}
				else if (BIT(chan.control, 6))
				{
					// DDA mode
					lout += vll * (chan.dda - 16);
					rout += vlr * (chan.dda - 16);
				}
				else
				{
					if ((m_lfo_control & 3) && (ch < 2))
					{
						if (ch == 0)
						{
							// Waveform mode with LFO
							channel &lfo_srcchan = m_channel[1];
							channel &lfo_dstchan = m_channel[0];
							const u16 lfo_step = lfo_srcchan.frequency ? lfo_srcchan.frequency : 0x1000;
							s32 step = lfo_dstchan.frequency ? lfo_dstchan.frequency : 0x1000;
							if (BIT(m_lfo_control, 7)) // reset LFO
							{
								lfo_srcchan.tick = lfo_step * m_lfo_frequency;
								lfo_srcchan.index = 0;
							}
							else
							{
								const s16 lfo_data = lfo_srcchan.waveform[lfo_srcchan.index];
								lfo_srcchan.tick--;
								if (lfo_srcchan.tick <= 0)
								{
									lfo_srcchan.tick = lfo_step * m_lfo_frequency; // verified from manual
									lfo_srcchan.index = (lfo_srcchan.index + 1) & 0x1f;
								}
								step += (lfo_data - 16) * (1 << (((m_lfo_control & 3) - 1) << 1)); // verified from manual
							}
							const s16 data = lfo_dstchan.waveform[lfo_dstchan.index];
							lfo_dstchan.tick--;
							if (lfo_dstchan.tick <= 0)
							{
								lfo_dstchan.tick = step;
								lfo_dstchan.index = (lfo_dstchan.index + 1) & 0x1f;
							}
							lout += vll * (data - 16);
							rout += vlr * (data - 16);
						}
						else if (ch == 1) // NOT muted even when LFO is on
						{
							const s16 data = chan.waveform[chan.index];
							lout += vll * (data - 16);
							rout += vlr * (data - 16);
						}
					}
					else
					{
						// Waveform mode
						const u32 step = chan.frequency ? chan.frequency : 0x1000;
						const s16 data = chan.waveform[chan.index];
						chan.tick--;
						if (chan.tick <= 0)
						{
							chan.tick = step;
							chan.index = (chan.index + 1) & 0x1f;
						}
						lout += vll * (data - 16);
						rout += vlr * (data - 16);
					}
				}
			}
		}
		left = lout / 32768.0f;
		right = rout / 32768.0f;
	}
}


void Huc6280::write(uint32_t offset, uint8_t data)
{
	channel &chan = m_channel[m_select];

	// The VGM player advances audio before each timed write.

	switch (offset & 0x0f)
	{
		case 0x00: // Channel select
			m_select = data & 0x07;
			break;

		case 0x01: // Global balance
			m_balance = data;
			break;

		case 0x02: // Channel frequency (LSB)
			chan.frequency = (chan.frequency & 0x0f00) | data;
			break;

		case 0x03: // Channel frequency (MSB)
			chan.frequency = (chan.frequency & 0x00ff) | ((data << 8) & 0x0f00);
			break;

		case 0x04: // Channel control (key-on, DDA mode, volume)

			// 1-to-0 transition of DDA bit resets waveform index
			if (BIT(chan.control, 6) && BIT(~data, 6))
			{
				chan.index = 0;
			}
			if (BIT(~chan.control, 7) && BIT(data, 7))
			{
				chan.tick = chan.frequency;
			}
			chan.control = data;

			// Cache channel enable flag
			m_enabled &= ~(1 << m_select);
			m_enabled |= BIT(data, 7) << m_select;
			break;

		case 0x05: // Channel balance
			chan.balance = data;
			break;

		case 0x06: // Channel waveform data

			switch (chan.control & 0x40)
			{
				case 0x00: // Waveform
					chan.waveform[chan.index & 0x1f] = data & 0x1f;
					if (BIT(~chan.control, 7)) // TODO : wave pointer is increased at writing data when sound playback is off??
						chan.index = (chan.index + 1) & 0x1f;
					break;

				case 0x40: // Direct D/A
					chan.dda = data & 0x1f;
					break;
			}

			break;

		case 0x07: // Noise control (enable, frequency)
			chan.noise_control = data;
			break;

		case 0x08: // LFO frequency
			m_lfo_frequency = data;
			break;

		case 0x09: // LFO control (enable, mode)
			m_lfo_control = data;
			break;

		default:
			break;
	}
}

