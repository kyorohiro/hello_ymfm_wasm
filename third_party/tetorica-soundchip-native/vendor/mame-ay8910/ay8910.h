// license:BSD-3-Clause
// copyright-holders:Couriersud
// Standalone adaptation; see README.md for pinned MAME source and output model.
#pragma once
#include <cstdint>
#include <array>
using u8=uint8_t; using u32=uint32_t; using s8=int8_t; using s32=int32_t;
class AY8910 {
public:
    AY8910(uint32_t rate, uint32_t clock, uint8_t type=0, uint8_t flags=1);
    void reset();
    void write(uint8_t reg,uint8_t value);
    uint8_t read(uint8_t reg) const { return regs[reg & 15]; }
    void generate(float *left,float *right,uint32_t frames);
    uint32_t sample_rate() const {return rate;}
    void set_mute_mask(uint32_t mask) {mute_mask=mask & 7;}
    // One native clock/8 tick, before host resampling or muting.
    std::array<float,3> tick();
struct ay_ym_param
	{
		double r_up;
		double r_down;
		int    res_count;
		double res[32];
	};
private:
struct tone_t
	{
		u32 period;
		u8 volume;
		u8 duty;
		s32 count;
		u8 duty_cycle;
		u8 output;

		void reset()
		{
			period = 0;
			volume = 0;
			duty = 0;
			count = 0;
			duty_cycle = 0;
			output = 0;
		}

		void set_period(u8 fine, u8 coarse)
		{
			period = fine | (coarse << 8);
		}

		void set_volume(u8 val)
		{
			volume = val;
		}

		void set_duty(u8 val)
		{
			duty = val;
		}
	};
struct envelope_t
	{
		u32 period;
		s32 count;
		s8 step;
		u32 volume;
		u8 hold, alternate, attack, holding;

		void reset()
		{
			period = 0;
			count = 0;
			step = 0;
			volume = 0;
			hold = 0;
			alternate = 0;
			attack = 0;
			holding = 0;
		}

		void set_period(u8 fine, u8 coarse)
		{
			period = fine | (coarse << 8);
		}

		void set_shape(u8 shape, u8 mask)
		{
			attack = (shape & 0x04) ? mask : 0x00;
			if ((shape & 0x08) == 0)
			{
				// if Continue = 0, map the shape to the equivalent one which has Continue = 1
				hold = 1;
				alternate = attack;
			}
			else
			{
				hold = shape & 0x01;
				alternate = shape & 0x02;
			}
			step = mask;
			holding = 0;
			volume = (step ^ attack);
		}
	};
    uint32_t rate, clock, divider;
    uint8_t type, flags;
    uint8_t regs[16]{};
    tone_t tones[3]{};
    envelope_t envelope{};
    uint32_t rng=1, noise_count=0, prescale=0, mute_mask=0;
    uint8_t env_mask, env_step;
    float volumes[32]{}, envelopes[32]{};
    std::array<float,3> last{};
    // Integer phase units: each output sample spans `clock` units,
    // and each chip tick spans `rate * divider` units.
    uint64_t tick_remaining=0;
};
