// license:BSD-3-Clause
// copyright-holders:Couriersud
#include "ay8910.h"
#include <algorithm>
#include <stdexcept>
static constexpr float MAX_OUTPUT=1.0f;
static const AY8910::ay_ym_param ym2149_param =
{
	630, 801,
	16,
	{ 73770, 37586, 27458, 21451, 15864, 12371, 8922,  6796,
		4763,  3521,  2403,  1737,  1123,   762,  438,   251 },
};
static const AY8910::ay_ym_param ym2149_param_env =
{
	630, 801,
	32,
	{ 103350, 73770, 52657, 37586, 32125, 27458, 24269, 21451,
		18447, 15864, 14009, 12371, 10506,  8922,  7787,  6796,
		5689,  4763,  4095,  3521,  2909,  2403,  2043,  1737,
		1397,  1123,   925,   762,   578,   438,   332,   251 },
};
static const AY8910::ay_ym_param ay8910_param =
{
	800000, 8000000,
	16,
	{ 15950, 15350, 15090, 14760, 14275, 13620, 12890, 11370,
		10600,  8590,  7190,  5985,  4820,  3945,  3017,  2345 }
};
static inline void build_single_table(double rl, const AY8910::ay_ym_param *par, int normalize, float *tab, int zero_is_off)
{
	double rt;
	double rw;
	double temp[32], min = 10.0, max = 0.0;

	for (int j = 0; j < par->res_count; j++)
	{
		rt = 1.0 / par->r_down + 1.0 / rl;

		rw = 1.0 / par->res[j];
		rt += 1.0 / par->res[j];

		if (!(zero_is_off && j == 0))
		{
			rw += 1.0 / par->r_up;
			rt += 1.0 / par->r_up;
		}

		temp[j] = rw / rt;
		if (temp[j] < min)
			min = temp[j];
		if (temp[j] > max)
			max = temp[j];
	}
	if (normalize)
	{
		for (int j = 0; j < par->res_count; j++)
			tab[j] = MAX_OUTPUT * (((temp[j] - min)/(max-min)) - 0.25) * 0.5;
	}
	else
	{
		for (int j = 0; j < par->res_count; j++)
			tab[j] = MAX_OUTPUT * temp[j];
	}

}
AY8910::AY8910(uint32_t sample_rate,uint32_t input_clock,uint8_t chip_type,uint8_t output_flags)
 : rate(sample_rate),clock(input_clock),divider(chip_type==0x10 && (output_flags & 0x10) ? 16 : 8),type(chip_type),flags(output_flags) {
    if (!rate || !clock || (type!=0 && type!=0x10) || (flags & ~0x11) || (type==0 && (flags & 0x10)))
        throw std::invalid_argument("Unsupported AY type, flags or clock");
    env_mask=type==0 ? 15 : 31; env_step=type==0 ? 2 : 1;
    build_single_table(1000,type==0 ? &ay8910_param : &ym2149_param,flags & 1,volumes,type==0);
    build_single_table(1000,type==0 ? &ay8910_param : &ym2149_param_env,flags & 1,envelopes,0);
    reset();
}
void AY8910::reset() {
    std::fill(std::begin(regs),std::end(regs),0);
    for(auto &tone:tones)tone.reset();
    envelope.reset(); rng=1; noise_count=prescale=0; tick_remaining=0; last={};
    for(int r=0;r<14;r++)write(r,0);
}
void AY8910::write(uint8_t reg,uint8_t value) {
    reg &= 15; regs[reg]=value;
    if(reg<6) {int ch=reg/2;tones[ch].set_period(regs[ch*2],regs[ch*2+1]&15);}
    else if(reg>=8 && reg<=10)tones[reg-8].set_volume(value);
    else if(reg==11 || reg==12)envelope.set_period(regs[11],regs[12]);
    else if(reg==13)envelope.set_shape(value,env_mask);
    // I/O latches and direction bits remain in regs; no external CPU callbacks.
}
std::array<float,3> AY8910::tick() {
    for(auto &tone:tones) {
        const int period=std::max<int>(1,tone.period);
        ++tone.count;
        while(tone.count>=period) {
            tone.duty_cycle=(tone.duty_cycle-1)&31;
            tone.output=tone.duty_cycle&1; tone.count-=period;
        }
    }
    if(++noise_count >= (regs[6]&31)) {
        noise_count=0; prescale^=1;
        if(!prescale)rng=(rng>>1)|(((rng^(rng>>3))&1)<<16);
    }
    if(!envelope.holding && ++envelope.count >= envelope.period*env_step) {
        envelope.count=0; --envelope.step;
        if(envelope.step<0) {
            if(envelope.hold) {
                if(envelope.alternate)envelope.attack^=env_mask;
                envelope.holding=1; envelope.step=0;
            } else {
                if(envelope.alternate && (envelope.step & (env_mask+1)))envelope.attack^=env_mask;
                envelope.step &= env_mask;
            }
        }
    }
    envelope.volume=envelope.step^envelope.attack;
    std::array<float,3> result;
    for(int ch=0;ch<3;ch++) {
        bool enabled=(tones[ch].output | ((regs[7]>>ch)&1)) & ((rng&1)|((regs[7]>>(ch+3))&1));
        result[ch]=(tones[ch].volume&16) ? envelopes[enabled?envelope.volume:0] : volumes[enabled?(tones[ch].volume&15):0];
    }
    return result;
}
void AY8910::generate(float *left,float *right,uint32_t frames) {
    for(uint32_t i=0;i<frames;i++) {
        uint64_t remaining=clock; double sum=0;
        while(remaining) {
            if(!tick_remaining) {last=tick();tick_remaining=uint64_t(rate)*divider;}
            auto duration=std::min(remaining,tick_remaining);
            for(int ch=0;ch<3;ch++)if(!(mute_mask&(1<<ch)))sum+=last[ch]*double(duration);
            remaining-=duration;tick_remaining-=duration;
        }
        left[i]=right[i]=float(sum/(double(clock)*3));
    }
}
