// Test harness: run the vendored accurate DSP's actual BRR decoder directly.
// No copy of its arithmetic and no change to production visibility or exports.
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#define private public
#include "SPC_DSP.cpp"
#undef private
static unsigned read_le(unsigned count) {
    unsigned n=0;
    for(unsigned i=0;i<count;++i) {int c=std::getchar();if(c==EOF) std::exit(2);n|=unsigned(c)<<(i*8);}
    return n;
}
int main() {
    unsigned count=read_le(4);
    while(count--) {
        unsigned blocks=read_le(4);
        int history1=(int16_t)read_le(2),history2=(int16_t)read_le(2);
        uint8_t ram[65536]={};
        SPC_DSP dsp;dsp.init(ram);
        SPC_DSP::voice_t voice={};
        voice.buf[SPC_DSP::brr_buf_size-1]=history1;
        voice.buf[SPC_DSP::brr_buf_size*2-1]=history1;
        voice.buf[SPC_DSP::brr_buf_size-2]=history2;
        voice.buf[SPC_DSP::brr_buf_size*2-2]=history2;
        for(unsigned block=0;block<blocks;++block) {
            for(unsigned i=0;i<9;++i) ram[0x200+i]=(uint8_t)read_le(1);
            voice.brr_addr=0x200;
            dsp.m.t_brr_header=ram[0x200];
            for(int offset=1;offset<9;offset+=2) {
                voice.brr_offset=offset;
                dsp.m.t_brr_byte=ram[0x200+offset];
                int position=voice.buf_pos;
                dsp.decode_brr(&voice);
                for(int i=0;i<4;++i) {
                    unsigned sample=(uint16_t)voice.buf[position+i];
                    std::putchar(sample&255);std::putchar(sample>>8);
                }
            }
        }
    }
    return std::ferror(stdout)?3:0;
}
