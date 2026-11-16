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
#include <vector>
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
std::vector<float> m_vol3d_table=std::vector<float>(8*32*32*32);
Callback m_port_a_write_cb,m_port_b_write_cb;
float mix_3D();
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
for sig in ['static inline void build_single_table(', 'static inline void build_3D_table(', 'sound_stream::sample_t ay8910_device::mix_3D(', 'void ay8910_device::ay8910_write_reg(', 'void ay8910_device::sound_stream_update(', 'void ay8910_device::ay8910_reset_ym(']:
    s+=block(cpp,sig)+'\n'
s+=r'''
int main(){
uint64_t checked=0,single_checked=0,mute_checked=0,nonlinear_cases=0;
for(int type: {0,16})for(int flags:{0,1,2,3,16,17,18,19}){
  if(!type && (flags&16))continue;
  const bool single=(flags&2)!=0;
  AY8910 port(44100,1789773,type,flags); ay8910_device ref;
  ref.m_env_step_mask=type?31:15;ref.m_step=type?1:2;
  ref.m_streams=single?1:3;
  for(int c=0;c<3;c++){
    build_single_table(1000,type?&ym2149_param:&ay8910_param,flags&1,ref.m_vol_table[c],!type);
    build_single_table(1000,type?&ym2149_param_env:&ay8910_param,flags&1,ref.m_env_table[c],0);
  }
  // Compile the pinned MAME table builder and mixer unchanged. MAME's
  // normalized single-output table has factor 3; the host divides its mono
  // stream by 3 only when generating public PCM, outside this native oracle.
  if(single)build_3D_table(1000,type?&ym2149_param:&ay8910_param,
      type?&ym2149_param_env:&ay8910_param,flags&1,3,!type,ref.m_vol3d_table.data());
  auto equal=[&](float actual,float expected,const char *where){
    if(!std::isfinite(actual)||std::abs(actual-expected)>1e-7){
      std::cerr<<"Mismatch "<<where<<" type="<<type<<" flags="<<flags
        <<" tick="<<checked<<" actual="<<actual<<" expected="<<expected<<"\n";
      std::exit(1);
    }
  };
  auto reset=[&](){port.reset();ref.ay8910_reset_ym();};
  auto write=[&](int r,int v){port.write(r,v);ref.ay8910_write_reg(r,v);};
  auto render=[&](int n){for(int i=0;i<n;i++){
    auto output=port.tick();sound_stream stream;ref.sound_stream_update(stream);
    if(single){
      const float mixed=port.mixed_tick_output();
      equal(mixed,stream.out[0],"single native tick");single_checked++;
      if(std::abs(mixed-(output[0]+output[1]+output[2]))>1e-5)nonlinear_cases++;
      if(checked%257==0){
        // Host mutes gate level codes to zero while preserving each channel's
        // resistor/envelope selector. The original mix_3D remains the oracle;
        // all-muted exact silence is an explicit host policy, not a MAME claim.
        const std::array<u8,3> gates={ref.m_vol_enabled[0],ref.m_vol_enabled[1],ref.m_vol_enabled[2]};
        for(int mask=1;mask<8;mask++){
          for(int c=0;c<3;c++)ref.m_vol_enabled[c]=(mask&(1<<c))?0:gates[c];
          port.set_mute_mask(mask);
          equal(port.mixed_tick_output(),mask==7?0:ref.mix_3D(),"host mute");mute_checked++;
        }
        for(int c=0;c<3;c++)ref.m_vol_enabled[c]=gates[c];
        port.set_mute_mask(0);
      }
    }else for(int c=0;c<3;c++)equal(output[c],stream.out[c],"independent native tick");
    checked++;
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
  if(single){
    // Unequal fixed levels detect averaging substituted for tied-pin mixing.
    // Every hardware fixed-level tuple is exercised with outputs held high.
    write(7,63);
    for(int a=0;a<16;a++)for(int b=0;b<16;b++)for(int c=0;c<16;c++){
      write(8,a);write(9,b);write(10,c);render(1);
    }
    // All fixed/envelope selections, gate combinations and AY/YM envelope
    // levels. Real shared-envelope constraints are retained by the emulator.
    for(int e=0;e<8;e++)for(int gates=0;gates<64;gates++){
      write(7,gates);write(8,(e&1)?16:3);write(9,(e&2)?16:9);write(10,(e&4)?16:15);
      write(11,1);write(12,0);write(13,10);render(128);
    }
    // At one output frame per native tick there is no resampling ambiguity:
    // public stereo PCM must equal MAME's mono stream / 3. Use a separate
    // instance so direct tick testing above cannot disturb resampling state.
    const int divider=(type&&(flags&16))?16:8;
    AY8910 pcm(44100,44100*divider,type,flags);ref.ay8910_reset_ym();
    auto pcm_write=[&](int r,int v){pcm.write(r,v);ref.ay8910_write_reg(r,v);};
    pcm_write(7,0);pcm_write(0,3);pcm_write(2,19);pcm_write(4,97);
    pcm_write(6,7);pcm_write(8,16);pcm_write(9,11);pcm_write(10,15);
    pcm_write(11,2);pcm_write(12,0);pcm_write(13,14);
    float left[257],right[257];
    pcm.generate(left,right,257);
    for(int i=0;i<257;i++){
      sound_stream stream;ref.sound_stream_update(stream);
      equal(left[i],stream.out[0]/3,"host single PCM");
      equal(right[i],left[i],"host mono duplication");
    }
  }
}
if(!single_checked||!mute_checked||!nonlinear_cases)return 2;
std::cout<<"MAME AY8910/YM2149 reference matched "<<checked<<" native ticks ("
  <<single_checked<<" single-output; "<<mute_checked<<" host mute checks)\n";
}
'''
with tempfile.TemporaryDirectory(prefix='ay8910_reference_') as tmp:
    source=Path(tmp)/'reference.cpp';source.write_text(s);exe=Path(tmp)/'reference'
    subprocess.run(['c++','-std=c++17','-O2','-I'+str(root/'third_party/mame-ay8910'),str(source),str(root/'third_party/mame-ay8910/ay8910.cpp'),'-o',str(exe)],check=True)
    subprocess.run([str(exe)],check=True)
