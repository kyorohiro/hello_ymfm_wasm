// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro
// Original waveform, melody and stereo host. No game assets or device.
#include "ps1_spu_pattern.hpp"
#include <fstream>
#include <iostream>
#include <string>
namespace {
void u16(std::ostream& out,unsigned v){out.put(char(v));out.put(char(v>>8));}
void u32(std::ostream& out,unsigned v){u16(out,v);u16(out,v>>16);}
}
int main(int argc,char** argv){
    if(argc!=2){std::cerr<<"Usage: tetorica_ps1_spu_wav output.wav\n";return 2;}
    try{
        ps1_pattern::Chip chip;ps1_pattern::configure(chip);ps1_pattern::room(chip);chip.write(0x198,1);
        constexpr unsigned frames=ps1_pattern::rate*3,step=ps1_pattern::rate/4;
        ps1_pattern::Audio audio(frames);constexpr int notes[]={60,64,67,71,72,67,64,62,60,67,64,60};
        for(unsigned at=0;at<frames;at+=step){
            ps1_pattern::voice(chip,0,unsigned(std::lround(4096*440*std::pow(2.,(notes[at/step]-69)/12.)*112/44100.)));
            ps1_pattern::key(chip,0,true);
            auto part=ps1_pattern::render(chip,step*4/5);ps1_pattern::key(chip,0,false);
            auto tail=ps1_pattern::render(chip,step-step*4/5);
            for(unsigned i=0;i<step;++i){const auto& src=i<part.left.size()?part:tail;unsigned j=i<part.left.size()?i:i-unsigned(part.left.size());
                audio.left[at+i]=src.left[j];audio.right[at+i]=src.right[j];}
        }
        std::ofstream out(argv[1],std::ios::binary|std::ios::trunc);ps1_pattern::require(bool(out));
        out.write("RIFF",4);u32(out,36+frames*4);out.write("WAVEfmt ",8);u32(out,16);u16(out,1);u16(out,2);
        u32(out,44100);u32(out,44100*4);u16(out,4);u16(out,16);out.write("data",4);u32(out,frames*4);
        for(unsigned i=0;i<frames;++i){double fade=std::min(1.,std::min(i/441.,(frames-i-1)/882.));
            for(float value:{audio.left[i],audio.right[i]}){double sample=value*fade;ps1_pattern::require(std::isfinite(sample)&&std::abs(sample)<1);
                u16(out,unsigned(uint16_t(int16_t(std::lround(sample*32767)))));}}
        out.close();ps1_pattern::require(bool(out));std::cout<<"Wrote original 3-second 44100 Hz stereo PS1 instrument WAV\n";return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
