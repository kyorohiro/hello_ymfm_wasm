"""Compare the adaptation with pinned, unmodified MAME register/render routines.

Only MAME framework services are stubbed. Run: python3 scripts/verify_rf5c164_reference.py
Requires a C++14 compiler. No downloads or MAME build required.
"""
from pathlib import Path
import subprocess
import tempfile
root = Path(__file__).resolve().parent.parent
upstream = (root / 'third_party/mame-rf5c164/upstream/rf5c68.cpp').read_text()
def function(signature):
    start = upstream.index(signature)
    brace = upstream.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (upstream[end] == '{') - (upstream[end] == '}')
        end += 1
    return upstream[start:end]
source = r'''
#include <algorithm>
#include <array>
#include <vector>
#include <cstdint>
#include <iostream>
#include "rf5c164.h"
using u8=uint8_t; using s32=int32_t; using offs_t=uint32_t;
struct sound_stream {
    std::vector<float> left, right;
    sound_stream(int n):left(n,0),right(n,0){}
    int samples() const {return left.size();}
    void update(){}
    void put_int_clamp(int ch,int i,int v,int scale) {
        (ch ? right:left)[i]=std::max(-scale,std::min(scale-1,v))/float(scale);
    }
};
struct Cache {
    std::array<uint8_t,65536> ram{};
    uint8_t read_byte(uint16_t a){return ram[a];}
};
struct Callback {bool isnull(){return true;} void operator()(int){}};
class rf5c68_device {
public:
    struct pcm_channel {uint8_t enable=0,env=0,pan=0,start=0;uint32_t addr=0;uint16_t step=0,loopst=0;};
    std::array<pcm_channel,8> m_chan{};
    uint8_t m_cbank=0,m_enable=0;uint16_t m_wbank=0;int m_output_bits=16;
    Cache m_cache;Callback m_sample_end_cb;
    std::vector<int32_t> m_mixleft,m_mixright;
    sound_stream stub{1}; sound_stream *m_stream=&stub;
    void sound_stream_update(sound_stream &stream);
    void rf5c68_w(offs_t offset,u8 data);
};
'''
source += function('void rf5c68_device::sound_stream_update(') + '\n'
source += function('void rf5c68_device::rf5c68_w(') + '\n'
source += r'''
int main() {
    RF5C164 port(44100,44100*384);
    rf5c68_device reference;
    std::array<uint8_t,65536> ram;
    for(unsigned i=0;i<ram.size();i++) ram[i]=uint8_t((i*37+11)%255);
    for(unsigned c=0;c<8;c++) ram[c*256+200]=0xff;
    reference.m_cache.ram=ram; port.load(ram.data(),0,ram.size());
    auto write=[&](int r,int v){port.write(r,v);reference.rf5c68_w(r,v);};
    for(int c=0;c<8;c++) {
        write(7,0xc0|c);write(0,255-c*17);write(1,0xf0+c);
        write(2,71+c*13);write(3,8+c);write(4,0);write(5,c);write(6,c);
    }
    write(8,0);
    int count=0;
    for(int block=0;block<100;block++) {
        if(block==20)write(8,0xaa);
        if(block==30)write(8,0);
        if(block==40)write(7,0);
        if(block==45)write(7,0xc3);
        if(block==60) {write(0,17);write(1,0x0f);}
        if(block==70) {
            ram[3*256]=0xff; // loop marker at loop destination
            reference.m_cache.ram=ram;port.load(ram.data(),0,ram.size());
        }
        int n=1+(block*53)%997;
        sound_stream expected(n);
        reference.sound_stream_update(expected);
        std::vector<float> l(n),r(n);port.generate(l.data(),r.data(),n);
        if(l!=expected.left || r!=expected.right) {
            std::cerr << "Mismatch at block " << block << std::endl;return 1;
        }
        count+=n;
    }
    std::cout << "MAME reference comparison passed: " << count << " stereo frames" << std::endl;
}
'''
with tempfile.TemporaryDirectory(prefix='rf5c164-reference-') as folder:
    folder=Path(folder)
    (folder/'reference.cpp').write_text(source)
    subprocess.run(['c++','-std=c++14','-O2','-I'+str(root/'third_party/mame-rf5c164'),str(folder/'reference.cpp'),str(root/'third_party/mame-rf5c164/rf5c164.cpp'),'-o',str(folder/'verify')],check=True)
    subprocess.run([str(folder/'verify')],check=True)
