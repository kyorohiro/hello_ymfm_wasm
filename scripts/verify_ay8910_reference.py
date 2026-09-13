"""Compare standalone AY/YM native output against pinned MAME routines.
Only framework services are stubbed; original register/render/reset code is compiled.
Run: python3 scripts/verify_ay8910_reference.py (C++17, no downloads).
"""
from pathlib import Path
import subprocess
import tempfile
root=Path(__file__).resolve().parent.parent
cpp=(root/'third_party/mame-ay8910/upstream/ay8910.cpp').read_text()
h=(root/'third_party/mame-ay8910/upstream/ay8910.h').read_text()
def block(text,signature):
    a=text.index(signature); b=text.index('{',a); d=1;e=b+1
    while d:
        d+=(text[e]=='{')-(text[e]=='}');e+=1
    return text[a:e]
s=r'''
#include "ay8910.h"
#include <algorithm>
#include <iostream>
#include <cmath>
#define BIT(x,n) (((x)>>(n))&1)
#define LOGMASKED(...) ((void)0)
using s16=int16_t;
struct sound_stream {using sample_t=float; float out[3]{};int samples(){return 1;}void put(int c,int,float v){out[c]=v;}};
struct Callback { bool isunset(){return true;}template<class... T>void operator()(T...){} };
class ay8910_device {
public:
static constexpr unsigned NUM_CHANNELS=3;
static constexpr int PSG_HAS_EXPANDED_MODE=1,PSG_EXTENDED_ENVELOPE=2;
using ay_ym_param=AY8910::ay_ym_param;
'''
a=h.index('\tenum\n',h.index('// register id'));b=h.index('\n\t// internal helpers',a)
s+=h[a:b]
s+=r'''
bool m_active=false;u8 m_register_latch=0,m_regs[32]{},m_last_enable=0;
tone_t m_tone[3]{};envelope_t m_envelope[3]{};
u8 m_prescale_noise=0; s16 m_noise_value=0,m_count_noise=0;u32 m_rng=1;
u8 m_noise_out=0,m_mode=0,m_env_step_mask=15,m_vol_enabled[3]{};
int m_step=2,m_feature=0,m_streams=3,m_ready=0;
float m_vol_table[3][16]{},m_env_table[3][32]{};
Callback m_port_a_write_cb,m_port_b_write_cb;
float mix_3D(){std::abort();}
void ay8910_write_reg(int,int);
void sound_stream_update(sound_stream&);
void ay8910_reset_ym();
};
static constexpr float MAX_OUTPUT=1;
'''
s+=block(cpp,'static const u32 duty_cycle[9]')+';\n'
for sig in ['static const ay8910_device::ay_ym_param ym2149_param =','static const ay8910_device::ay_ym_param ym2149_param_env =']:
    s+=block(cpp,sig)+';\n'
s+=block(cpp[cpp.index('The ZX spectrum output circuit'):],'static const ay8910_device::ay_ym_param ay8910_param =')+';\n'
for sig in ['static inline void build_single_table(', 'void ay8910_device::ay8910_write_reg(', 'void ay8910_device::sound_stream_update(', 'void ay8910_device::ay8910_reset_ym(']:
    s+=block(cpp,sig)+'\n'
s+=r'''
int main(){
uint64_t checked=0;
for(int type: {0,16})for(int flags:{0,1}){
  AY8910 port(44100,1789773,type,flags); ay8910_device ref;
  ref.m_env_step_mask=type?31:15;ref.m_step=type?1:2;
  for(int c=0;c<3;c++){
    build_single_table(1000,type?&ym2149_param:&ay8910_param,flags,ref.m_vol_table[c],!type);
    build_single_table(1000,type?&ym2149_param_env:&ay8910_param,flags,ref.m_env_table[c],0);
  }
  auto reset=[&](){port.reset();ref.ay8910_reset_ym();};
  auto write=[&](int r,int v){port.write(r,v);ref.ay8910_write_reg(r,v);};
  auto render=[&](int n){for(int i=0;i<n;i++){
    auto output=port.tick();sound_stream stream;ref.sound_stream_update(stream);
    for(int c=0;c<3;c++)if(std::abs(output[c]-stream.out[c])>1e-7){
      std::cerr<<"Mismatch type="<<type<<" flags="<<flags<<" tick="<<checked<<" channel="<<c<<"\n";std::exit(1);
    }checked++;
  }};
  for(int shape=0;shape<16;shape++)for(int period: {0,1,2,65535}){
    reset();write(7,0);write(0,1);write(2,17);write(4,255);write(5,15);
    write(6,3);write(8,16);write(9,16);write(10,16);
    write(11,period&255);write(12,period>>8);write(13,shape);render(4096);
    write(13,shape);render(1024); // same-value shape write retriggers
    write(0,0);write(2,255);write(3,255);render(100);
  }
  uint32_t random=1234;
  for(int i=0;i<12000;i++){
    random=random*1664525+1013904223;write((random>>16)&15,random>>24);
    render(1+(random&31));
  }
  for(int mixer=0;mixer<64;mixer++)for(int volume=0;volume<16;volume++){
    write(7,mixer);write(8,volume);write(9,volume);write(10,volume);render(128);
  }
}
std::cout<<"MAME AY8910/YM2149 reference matched "<<checked<<" native ticks\n";
}
'''
with tempfile.TemporaryDirectory(prefix='ay8910_reference_') as tmp:
    source=Path(tmp)/'reference.cpp';source.write_text(s);exe=Path(tmp)/'reference'
    subprocess.run(['c++','-std=c++17','-O2','-I'+str(root/'third_party/mame-ay8910'),str(source),str(root/'third_party/mame-ay8910/ay8910.cpp'),'-o',str(exe)],check=True)
    subprocess.run([str(exe)],check=True)
