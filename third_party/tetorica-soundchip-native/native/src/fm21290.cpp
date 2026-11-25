// SPDX-License-Identifier: BSD-3-Clause
#include "tetorica/fm21290.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <new>

namespace {
constexpr double tau = 6.2831853071795864769;
#include "fm21290_algorithms.inc"
struct Voice {
    bool active = false, held = false;
    uint64_t idle_since = 0;
    std::array<double,6> phase{}, gain{}, step{}, level{}, attack_scale{};
    std::array<unsigned,6> stage{}, rate_offset{};
    std::array<double,24> attack{}, decay{};
    double previous = 0, feedback = 0;
};
bool mapped(unsigned i) {
    return i < 0x2c || (i >= 0x30 && i < 0x36) || (i >= 0x40 && i < 0x58) ||
        (i >= 0x60 && i < 0x78) || (i >= 0x80 && i < 0xe6) || (i >= 0xf0 && i < 0xf4);
}
}
struct fm21290_chip {
    unsigned rate, mode = 0x50;
    bool sync = false;
    uint64_t frame = 0;
    std::array<unsigned,256> reg{};
    std::array<unsigned,16> algorithm{};
    std::array<Voice,16> voices{};
    std::array<double,64> attack{}, decay{};
    std::array<double,24> targets{};
    std::array<double,6> am{};
    std::array<double,32> carrier{};
    const double bus_scale = 2 * tau * std::exp2(0.25);
    explicit fm21290_chip(unsigned hz) : rate(hz) {
        std::fill(reg.begin()+0x80,reg.begin()+0xe0,255);
        am.fill(1);
        for (int r=0;r<64;r++) {
            attack[r]=std::exp2((r-32)/4.0)*9.6/rate;
            decay[r]=std::exp2(-(4+r%4)*std::exp2(r/4-22)*44100/rate);
        }
        for (auto& v: voices) {
            v.attack.fill(attack[0]); v.decay.fill(decay[0]); v.attack_scale.fill(1);
        }
        constexpr int log_gain[]={0,8,13,16,19,21};
        for (unsigned a=0;a<32;a++) {
            const int count=std::count_if(std::begin(routes[a]),std::end(routes[a]),[](int f){return (f&3)==0;});
            carrier[a]=std::exp2(-log_gain[count-1]/8.0);
        }
    }
    void update_rate(Voice& v,unsigned i) {
        unsigned r=std::min(63u,reg[0x40+i]+v.rate_offset[i/4]);
        v.attack[i]=attack[r]; v.decay[i]=decay[r];
    }
    void advance_idle(Voice& v) {
        if (v.active || frame==v.idle_since) return;
        auto elapsed=frame-v.idle_since;
        for (int op=0;op<6;op++) v.phase[op]=std::fmod(v.phase[op]+elapsed*v.step[op],tau);
        v.previous=elapsed==1?v.feedback:0; v.feedback=0; v.idle_since=frame;
    }
    void tune(unsigned ch) {
        Voice& v=voices[ch]; advance_idle(v);
        int key=reg[2*ch]*256+reg[2*ch+1];
        int note=static_cast<int>(std::floor(69.5+(key-0x5aa8)*12/4096.0));
        int group=std::clamp(static_cast<int>(std::floor(note/3.0))-7,0,31);
        int pm=reg[0xf2]*256+reg[0xf3]; if(pm>=32768) pm-=65536;
        for (int op=0;op<6;op++) {
            int pitch=reg[0x20+2*op]*256+reg[0x21+2*op];
            int dt=reg[0x30+op], cents=(dt&7)*((dt&8)?-1:1);
            unsigned offset=((reg[0xe0+op]&7)*group)>>3;
            if (offset!=v.rate_offset[op]) {
                v.rate_offset[op]=offset;
                for (int s=0;s<4;s++) update_rate(v,op*4+s);
            }
            double hz=(pitch&1)?std::exp2(((pitch&~3)-0x16ac)/4096.0):
                440*std::exp2((key+pm-0x5aa8+(pitch&~3)-0x232c)/4096.0);
            v.step[op]=tau*hz*std::exp2(cents/1200.0)/rate;
        }
    }
    bool write(unsigned addr,unsigned data) {
        if(data>255) return false;
        if(addr==0x2804) {
            mode=data; if(data&32) sync=true; if(data&64) sync=false; return true;
        }
        if(addr==0x2805) {
            if((mode&0x94)==0x10) algorithm.fill(data);
            else if(!(mode&0x90)) algorithm[mode&15]=data;
            return true;
        }
        unsigned i=addr-0x3000;
        if(!mapped(i)) return false;
        if((i==0xf0 || i>=0xf2) && reg[i]==data) return true;
        reg[i]=data;
        if(i==0xf0 || (i>=0xe0 && i<0xe6))
            for(unsigned op=0;op<6;op++) am[op]=std::exp2(-int((reg[0xe0+op]>>3 & 3)*reg[0xf0])/64.0);
        if(i<32) tune(i/2);
        else if(i<0x36 || i>=0xf2 || (i>=0xe0 && i<0xe6))
            for(unsigned ch=0;ch<16;ch++) tune(ch);
        else if(i<0x58) for(auto& v:voices) update_rate(v,i-0x40);
        else if(i<0x78) targets[i-0x60]=data>=63?0:std::exp2(-int(data)/4.0);
        else if(i<0xe0) {
            auto& v=voices[i&15]; unsigned op=(i-0x80)/16;
            v.level[op]=data>=254?0:std::exp2((11-int(data))/16.0);
            v.attack_scale[op]=std::exp2((std::min(int(data),123)-43)/40.0);
        } else if(i==0xf1) {
            auto& v=voices[data>>2 & 15];
            if((data&3)==1) {
                advance_idle(v); v.active=v.held=true; v.stage.fill(0);
                if(sync) v.phase.fill(0);
            } else if((data&3)==2) { v.held=false; v.stage.fill(3); }
        }
        return true;
    }
    void render(float* out,size_t n) {
        std::fill_n(out,n,0.0f);
        for(unsigned ch=0;ch<16;ch++) {
            auto& v=voices[ch]; unsigned a=algorithm[ch]>>3, fb=algorithm[ch]&7;
            double feedback=fb?bus_scale*std::exp2(int(fb)-9):0;
            for(size_t k=0;k<n && v.active;k++) {
                double bus[3]={}; bool sounding=false;
                for(unsigned op=0;op<6;op++) {
                    unsigned s=v.stage[op], i=op*4+s; double goal=targets[i];
                    double& g=v.gain[op];
                    if(g<goal) g=std::min(goal,g+v.attack[i]*v.attack_scale[op]);
                    else if(g>goal) { g=std::max(goal,g*v.decay[i]); if(goal==0 && g<1e-6) g=0; }
                    if(g==goal && s<2) v.stage[op]++;
                    unsigned f=routes[a][op], input=(f>>4)&3, dest=f&3;
                    double mod=input?bus[input]*bus_scale:0;
                    if(f&64) mod+=(v.previous+v.feedback)*feedback;
                    double value=std::sin(v.phase[op]+mod)*v.level[op]*g*am[op]*(dest==0?carrier[a]:1);
                    v.phase[op]=std::fmod(v.phase[op]+v.step[op],tau);
                    if(f&128) { v.previous=v.feedback; v.feedback=value; }
                    bus[dest]=(f&4)?bus[dest]+value:value;
                    sounding|=g*v.level[op]>1e-5;
                }
                out[k]+=bus[0]*0.08;
                if(!v.held && !sounding) { v.active=false; v.idle_since=frame+k+1; }
            }
        }
        frame+=n;
    }
};

fm21290_chip* fm21290_create(unsigned rate) {
    return rate>=8000 && rate<=384000?new(std::nothrow) fm21290_chip(rate):nullptr;
}
void fm21290_destroy(fm21290_chip* chip) { delete chip; }
int fm21290_write(fm21290_chip* chip,unsigned address,unsigned value) {
    return chip && chip->write(address,value);
}
int fm21290_render(fm21290_chip* chip,float* out,size_t frames) {
    if(!chip || (!out && frames)) return 0;
    if(frames) chip->render(out,frames);
    return 1;
}
