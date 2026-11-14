// license:BSD-3-Clause
// copyright-holders:Charles MacDonald
// Audio tick and register logic adapted from MAME c6280.cpp; see README.md.
#include "huc6280.h"
#include <cmath>
#include <cstring>
#include <limits>
#define BIT(value, bit) ((uint32_t(value) >> (bit)) & 1U)
namespace {
// Compatibility ID for the unchanged synthesis model (the pre-checkpoint
// huc6280.cpp SHA-256 prefix). Bump this ID when synthesis or state semantics
// change; a format-version bump alone does not describe model compatibility.
constexpr uint64_t STATE_MODEL = UINT64_C(0x5693c83943957e2e);
constexpr uint8_t STATE_MAGIC[8] = {'H','U','C','S','A','V','E','1'};
uint16_t state_u16(const uint8_t *p) { return uint16_t(p[0]) | uint16_t(p[1]) << 8; }
uint32_t state_u32(const uint8_t *p) { return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24; }
uint64_t state_u64(const uint8_t *p) { return uint64_t(state_u32(p)) | uint64_t(state_u32(p + 4)) << 32; }
void state_put16(uint8_t *p, uint16_t value) { p[0] = uint8_t(value); p[1] = uint8_t(value >> 8); }
void state_put32(uint8_t *p, uint32_t value) { for (unsigned i = 0; i < 4; ++i) p[i] = uint8_t(value >> (8 * i)); }
void state_put64(uint8_t *p, uint64_t value) { state_put32(p, uint32_t(value)); state_put32(p + 4, uint32_t(value >> 32)); }
int32_t state_i32(const uint8_t *p) {
    const uint32_t value = state_u32(p);
    return value <= INT32_MAX ? int32_t(value) : int32_t(int64_t(value) - INT64_C(0x100000000));
}
int16_t state_i16(const uint8_t *p) { const uint16_t value = state_u16(p); return value <= INT16_MAX ? int16_t(value) : int16_t(int32_t(value) - 65536); }
float state_float(const uint8_t *p) {
    static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559, "State ABI requires IEEE-754 binary32");
    const uint32_t bits = state_u32(p); float result;
    std::memcpy(&result, &bits, 4); // Scalar float bit conversion, not an object snapshot.
    return result;
}
void state_put_float(uint8_t *p, float value) { uint32_t bits; std::memcpy(&bits, &value, 4); state_put32(p, bits); }
bool state_overlaps(const void *data, uint32_t size, const void *object, size_t object_size) {
    const uintptr_t start = reinterpret_cast<uintptr_t>(data), core = reinterpret_cast<uintptr_t>(object);
    if (size > UINTPTR_MAX - start) return true;
    return start < core + object_size && core < start + size;
}
}
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

bool Huc6280::save_state(uint8_t *data, uint32_t size) const {
    if (!data || size != state_bytes || state_overlaps(data, size, this, sizeof(*this))) return false;
    for (uint32_t i = 0; i < state_bytes; ++i) data[i] = 0;
    for (unsigned i = 0; i < 8; ++i) data[i] = STATE_MAGIC[i];
    state_put32(data + 8, 1); state_put32(data + 12, state_bytes); state_put64(data + 16, STATE_MODEL);
    state_put32(data + 24, m_clock); state_put32(data + 28, m_rate); state_put64(data + 32, m_phase);
    state_put_float(data + 40, m_left); state_put_float(data + 44, m_right);
    data[48] = m_select; data[49] = m_enabled; data[50] = m_balance; data[51] = m_lfo_frequency; data[52] = m_lfo_control;
    for (unsigned ch = 0; ch < 6; ++ch) if (m_muted[ch]) data[53] |= uint8_t(1U << ch);
    for (unsigned ch = 0; ch < 8; ++ch) {
        const channel &c = m_channel[ch]; uint8_t *p = data + 64 + 56 * ch;
        state_put16(p, c.frequency); p[2] = c.control; p[3] = c.balance;
        for (unsigned i = 0; i < 32; ++i) p[4 + i] = c.waveform[i];
        p[36] = c.index; p[37] = c.noise_control; state_put16(p + 38, uint16_t(c.dda));
        state_put32(p + 40, uint32_t(c.noise_counter)); state_put32(p + 44, c.noise_frequency); state_put32(p + 48, c.noise_seed);
        state_put32(p + 52, uint32_t(c.tick));
    }
    return true;
}

bool Huc6280::decode_state(const uint8_t *data, uint32_t size, decoded_state &state) const {
    if (!data || size != state_bytes || state_overlaps(data, size, this, sizeof(*this))) return false;
    for (unsigned i = 0; i < 8; ++i) if (data[i] != STATE_MAGIC[i]) return false;
    if (state_u32(data + 8) != 1 || state_u32(data + 12) != state_bytes || state_u64(data + 16) != STATE_MODEL ||
        state_u32(data + 24) != m_clock || state_u32(data + 28) != m_rate || !m_clock || !m_rate) return false;
    for (unsigned i = 54; i < 64; ++i) if (data[i]) return false;
    state.phase = state_u64(data + 32); state.left = state_float(data + 40); state.right = state_float(data + 44);
    if (state.phase >= m_rate || !std::isfinite(state.left) || !std::isfinite(state.right) ||
        std::fabs(state.left) > 1 || std::fabs(state.right) > 1 || data[48] > 7 || data[53] > 63) return false;
    state.select = data[48]; state.enabled = data[49]; state.balance = data[50]; state.lfo_frequency = data[51]; state.lfo_control = data[52]; state.muted = data[53];
    uint8_t enabled = 0;
    for (unsigned ch = 0; ch < 8; ++ch) {
        channel &c = state.channels[ch]; const uint8_t *p = data + 64 + 56 * ch;
        c.frequency = state_u16(p); c.control = p[2]; c.balance = p[3];
        if (c.frequency > 4095) return false;
        for (unsigned i = 0; i < 32; ++i) { c.waveform[i] = p[4 + i]; if (c.waveform[i] > 31) return false; }
        c.index = p[36]; c.noise_control = p[37]; c.dda = state_i16(p + 38);
        c.noise_counter = state_i32(p + 40); c.noise_frequency = state_u32(p + 44); c.noise_seed = state_u32(p + 48); c.tick = state_i32(p + 52);
        if (c.index > 31 || c.dda < 0 || c.dda > 31 || c.noise_counter < 0 || c.noise_counter > 1984 || c.noise_frequency != 0 || c.noise_seed > 0x3ffff) return false;
        if ((ch == 4 || ch == 5) && !c.noise_seed) return false;
        if (ch != 4 && ch != 5 && (c.noise_seed || c.noise_counter)) return false;
        const int32_t min_tick = ch == 0 ? -255 : 0, max_tick = ch == 1 ? 1044480 : ch == 0 ? 4336 : 4096;
        if (c.tick < min_tick || c.tick > max_tick) return false;
        if (c.control & 128) enabled |= uint8_t(1U << ch);
    }
    return enabled == state.enabled;
}

bool Huc6280::validate_state(const uint8_t *data, uint32_t size) const { decoded_state state{}; return decode_state(data, size, state); }
bool Huc6280::load_state(const uint8_t *data, uint32_t size) {
    decoded_state state{}; if (!decode_state(data, size, state)) return false;
    // No member is touched until the entire version/model/configuration and
    // all eight voices have passed validation. Derived volume tables stay local.
    m_phase = state.phase; m_left = state.left; m_right = state.right; m_select = state.select; m_enabled = state.enabled;
    m_balance = state.balance; m_lfo_frequency = state.lfo_frequency; m_lfo_control = state.lfo_control;
    for (unsigned ch = 0; ch < 6; ++ch) m_muted[ch] = (state.muted & (1U << ch)) != 0;
    for (unsigned ch = 0; ch < 8; ++ch) m_channel[ch] = state.channels[ch];
    return true;
}

