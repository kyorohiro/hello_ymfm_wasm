// license:BSD-3-Clause
// copyright-holders:Olivier Galibert,Aaron Giles
// Standalone extra instance of the pinned MAME RF5C164 adaptation. The public
// bus and sample algorithm match native-megacd/rf5c164.cpp. Per-voice held sums
// add source-scoped cancellation without advancing unrelated sample addresses.
#include "native_genesis_extra_rf5c164.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
namespace {
struct Core {
    struct Channel { uint32_t address=0; uint16_t step=0, loop=0; };
    struct Held { std::array<int32_t,8> left{},right{}; };
    std::array<Channel,8> channels{};
    std::array<uint8_t,65536> ram{};
    NativeExtraRf5c164State state{};
    const uint32_t rate;
    uint64_t phase=0;
    double ratio=1,remainder=0;
    Held held{},history[8]{};
    uint8_t history_count=0;
    float output_left=0,output_right=0;
    explicit Core(uint32_t sr):rate(sr){state.clock=12500000;reset();}
    void reset(){
        const uint32_t clock=state.clock;const uint8_t resampling=state.resampling;
        state={};state.clock=clock;state.resampling=resampling;state.mask=255;
        channels={};held={};for(auto &h:history)h={};history_count=0;
        phase=uint64_t(rate)*384;remainder=0;output_left=output_right=0;
    }
    void write(uint8_t reg,uint8_t value){
        if(reg<7){auto &r=state.registers[state.selected];auto &ch=channels[state.selected];r[reg]=value;
            if(reg==2||reg==3)ch.step=uint16_t(r[2]|uint16_t(r[3])<<8);
            if(reg==4||reg==5)ch.loop=uint16_t(r[4]|uint16_t(r[5])<<8);
            if(reg==6&&(state.mask&(1u<<state.selected)))ch.address=uint32_t(value)<<19;
        }else if(reg==7){state.control=value;if(value&64)state.selected=value&7;else state.bank=uint16_t(value&15)<<12;
        }else if(reg==8){state.mask=value;for(uint8_t ch=0;ch<8;++ch)if(value&(1u<<ch))channels[ch].address=uint32_t(state.registers[ch][6])<<19;}
    }
    void tick(){
        held={};if(!(state.control&128))return;
        for(uint8_t i=0;i<8;++i){if(state.mask&(1u<<i))continue;auto &ch=channels[i];const auto &r=state.registers[i];
            int sample=ram[(ch.address>>11)&65535];
            if(sample==255){ch.address=uint32_t(ch.loop)<<11;sample=ram[(ch.address>>11)&65535];if(sample==255)continue;}
            ch.address+=ch.step;const int lv=(r[1]&15)*r[0],rv=(r[1]>>4)*r[0];
            if(sample&128){sample&=127;held.left[i]=(sample*lv)>>5;held.right[i]=(sample*rv)>>5;}
            else {held.left[i]=-((sample*lv)>>5);held.right[i]=-((sample*rv)>>5);}
        }
    }
    static void stereo(const Held&h,float &l,float&r){
        int32_t a=0,b=0;for(uint8_t ch=0;ch<8;++ch){a+=h.left[ch];b+=h.right[ch];}
        l=float(std::max(-32768,std::min(32767,a)))/32768.0f;r=float(std::max(-32768,std::min(32767,b)))/32768.0f;
    }
    void canonical(float&l,float&r){const uint64_t period=uint64_t(rate)*384;while(phase>=period){phase-=period;tick();}stereo(held,l,r);phase+=12500000;}
    void remix_history(){
        if(!history_count){output_left=output_right=0;return;}
        double l=0,r=0;for(uint8_t i=0;i<history_count;++i){float a,b;stereo(history[i],a,b);l+=a;r+=b;}
        output_left=float(l/history_count);output_right=float(r/history_count);
    }
    void sample(float*l,float*r){
        if(!state.resampling){canonical(output_left,output_right);history[0]=held;history_count=1;}
        else {remainder+=ratio;const uint32_t count=uint32_t(std::floor(remainder));remainder-=count;
            if(count){double a=0,b=0;history_count=uint8_t(count);for(uint32_t i=0;i<count;++i){float x,y;canonical(x,y);history[i]=held;a+=x;b+=y;}output_left=float(a/count);output_right=float(b/count);}}
        *l=output_left;*r=output_right;
    }
    void key_off(uint8_t ch){if(ch>=8)return;write(8,state.mask|(1u<<ch));held.left[ch]=held.right[ch]=0;for(auto &h:history)h.left[ch]=h.right[ch]=0;remix_history();}
};
Core*core(void*p){return static_cast<Core*>(p);}
bool range(uint32_t offset,uint32_t size){return offset<=65536&&size<=65536-offset;}
}
extern "C" {
void*native_extra_rf5c164_create(uint32_t rate){if(rate<8000||rate>384000)return nullptr;try{return new Core(rate);}catch(...){return nullptr;}}
void native_extra_rf5c164_destroy(void*p){delete core(p);}
void native_extra_rf5c164_reset(void*p){core(p)->reset();}
void native_extra_rf5c164_write(void*p,uint8_t reg,uint8_t value){core(p)->write(reg,value);}
void native_extra_rf5c164_write_memory(void*p,uint16_t offset,uint8_t value){auto*c=core(p);c->ram[uint16_t(c->state.bank|offset)]=value;}
int native_extra_rf5c164_load(void*p,const uint8_t*bytes,uint32_t offset,uint32_t size){if(!range(offset,size)||(!bytes&&size))return 0;if(size)std::memcpy(core(p)->ram.data()+offset,bytes,size);return 1;}
void native_extra_rf5c164_clear_memory(void*p){core(p)->ram.fill(0);}
void native_extra_rf5c164_sample(void*p,float*l,float*r){core(p)->sample(l,r);}
int native_extra_rf5c164_set_clock(void*p,uint32_t hz){if(hz<100000||hz>100000000)return 0;auto*c=core(p);if(!c->state.resampling){c->output_left=c->output_right=0;c->history_count=0;}c->state.resampling=1;c->state.clock=hz;c->ratio=double(hz)/12500000;return 1;}
uint8_t native_extra_rf5c164_read(void*p,uint8_t offset){return uint8_t(core(p)->channels[(offset&14)>>1].address>>((offset&1)?19:11));}
uint8_t native_extra_rf5c164_read_memory(void*p,uint16_t offset){return core(p)->ram[offset];}
int native_extra_rf5c164_read_memory_range(void*p,uint8_t*bytes,uint32_t offset,uint32_t size){if(!range(offset,size)||(!bytes&&size))return 0;if(size)std::memcpy(bytes,core(p)->ram.data()+offset,size);return 1;}
void native_extra_rf5c164_get_state(void*p,NativeExtraRf5c164State*out){auto*c=core(p);*out=c->state;for(uint8_t ch=0;ch<8;++ch)out->addresses[ch]=c->channels[ch].address;}
void native_extra_rf5c164_key_off(void*p,uint8_t ch){core(p)->key_off(ch);}
void native_extra_rf5c164_stop(void*p){for(uint8_t ch=0;ch<8;++ch)core(p)->key_off(ch);}
}
