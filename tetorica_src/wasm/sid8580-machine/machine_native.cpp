// SPDX-License-Identifier: BSD-3-Clause
// Raw authored programs only. No ROM/music is bundled by this harness.
#include "generated/sid8580_machine_core.h"
#include <fstream>
#include <iostream>
#include <sstream>
#include <vector>
#include <memory>
#include <map>
#include <string>
#include <stdexcept>
using Core=tetorica::Sid8580MachineCore;
static unsigned number(const std::string& text,unsigned maximum) {
    if(text.empty()||text.size()>10||text.find_first_not_of("0123456789")!=std::string::npos)throw std::runtime_error("Expected bounded unsigned decimal argument");
    const auto n=std::stoull(text);if(n>maximum)throw std::runtime_error("Numeric argument exceeds bound");return static_cast<unsigned>(n);
}
static std::vector<uint8_t> bytes(const std::string& path,size_t maximum) {
    std::ifstream file;std::istream* input=&std::cin;
    if(path!="-"){file.open(path,std::ios::binary);if(!file)throw std::runtime_error("Cannot open input file");input=&file;}
    std::vector<uint8_t> result;char c;
    while(input->get(c)){if(result.size()==maximum)throw std::runtime_error("Input file exceeds bound");result.push_back(static_cast<uint8_t>(c));}
    if(input->bad())throw std::runtime_error("Input read failed");return result;
}
static std::string quoted(const char* text) {
    std::ostringstream out;out<<'"';
    for(const unsigned char c:std::string(text)){if(c=='"'||c=='\\')out<<'\\'<<c;else if(c<32)out<<'?';else out<<c;}
    out<<'"';return out.str();
}
int main(int argc,char** argv) {
    try {
        std::map<std::string,std::string> options;
        const std::vector<std::string> names={"--program","--mode","--rate","--profiles","--load","--init","--play","--song","--driver-page","--frames","--chunk","--roms","--basic"};
        for(int i=1;i<argc;i+=2){const std::string key=argv[i];if(i+1>=argc||std::find(names.begin(),names.end(),key)==names.end()||!options.emplace(key,argv[i+1]).second)throw std::runtime_error("Unknown, duplicate or incomplete CLI option");}
        auto get=[&](const char* key,const char* fallback){auto at=options.find(key);return at==options.end()?std::string(fallback):at->second;};
        const unsigned rate=number(get("--rate","48000"),96000),profiles=number(get("--profiles","0"),3);
        const unsigned load=number(get("--load","4096"),65535),init=number(get("--init","4096"),65535),play=number(get("--play","4096"),65535);
        const unsigned song=number(get("--song","0"),255),page=number(get("--driver-page","0"),255),basic=number(get("--basic","0"),1);
        const unsigned frames=number(get("--frames",std::to_string(rate).c_str()),96000*60),chunk=number(get("--chunk","4096"),4096);
        const std::string mode=get("--mode","vbi");
        if(rate<8000||!chunk||(mode!="vbi"&&mode!="cia"&&mode!="rsid"))throw std::runtime_error("Unsupported rate/chunk/mode");
        const auto program=bytes(get("--program","-"),65536);if(program.empty())throw std::runtime_error("Empty program");
        std::vector<uint8_t> roms;
        if(options.count("--roms")){roms=bytes(options["--roms"],20480);if(roms.size()!=20480)throw std::runtime_error("Expected chars4096+basic8192+kernal8192 ROM bytes");}
        auto core=std::make_unique<Core>(rate,profiles);std::memcpy(core->input(),program.data(),program.size());
        if(!roms.empty())std::memcpy(core->romInput(),roms.data(),roms.size());
        const bool loaded=mode=="rsid"?core->load(program.size(),load,init,song,basic,!roms.empty()):
            mode=="cia"?core->loadPsid(program.size(),load,init,play,song,!roms.empty(),page):
            core->loadPsidVbi(program.size(),load,init,play,song,!roms.empty(),page);
        bool rendered=loaded;std::vector<float> output(frames,0);
        if(loaded)for(unsigned at=0;at<frames;){const unsigned count=std::min(chunk,frames-at);if(!core->render(count)){rendered=false;break;}std::copy_n(core->output(),count,output.data()+at);at+=count;}
        if(!rendered)std::fill(output.begin(),output.end(),0);
        static_assert(sizeof(float)==4&&std::numeric_limits<float>::is_iec559,"Expected IEEE float32");
        std::vector<char> binary(output.size()*4);
        for(size_t i=0;i<output.size();++i){uint32_t value;std::memcpy(&value,&output[i],4);for(unsigned b=0;b<4;++b)binary[i*4+b]=static_cast<char>((value>>(8*b))&255);}
        std::cout.write(binary.data(),binary.size());if(!std::cout)throw std::runtime_error("PCM write failed");
        std::ostringstream out;out<<"{\"format\":\"tetorica-sid8580-machine-native\",\"version\":1,\"loadAccepted\":"<<(loaded?"true":"false")<<",\"renderAccepted\":"<<(rendered?"true":"false")<<",\"state\":{";
        out<<"\"state\":"<<core->state()<<",\"errorCode\":"<<core->errorCode()<<",\"errorAddress\":"<<core->errorAddress()<<",\"error\":"<<quoted(core->error());
        out<<",\"cycles\":"<<core->cycles()<<",\"sidCycles\":"<<core->sidCycles()<<",\"clockHz\":985248,\"sampleRate\":"<<rate<<",\"model\":8580,\"profiles\":"<<profiles<<",\"hostDcHz\":12";
        out<<",\"initReturned\":"<<(core->initReturned()?"true":"false")<<",\"initPending\":"<<(core->initPending()?"true":"false")<<",\"initCycles\":"<<core->initCycles()<<",\"initCycleLimit\":"<<core->initLimit()<<",\"initReturnCycle\":"<<core->initReturnCycle()<<",\"bootCycles\":"<<core->bootCycles();
        out<<",\"irqCount\":"<<core->irqCount()<<",\"nmiCount\":"<<core->nmiCount()<<",\"playCalls\":"<<core->playCalls()<<",\"driverAddress\":"<<core->driverAddress()<<",\"readCount\":"<<core->readCount()<<",\"writeCount\":"<<core->writeCount()<<",\"pc\":"<<core->pc()<<",\"registers\":[";
        for(unsigned i=0;i<32;++i){if(i)out<<',';out<<core->reg(i);}out<<"]},\"ramStart\":816,\"ram\":[";
        for(unsigned i=0;i<32;++i){if(i)out<<',';out<<core->ramRead(0x330+i);}out<<"],\"ramExtra\":[{\"address\":54297,\"value\":"<<core->ramRead(0xd419)<<"},{\"address\":1024,\"value\":"<<core->ramRead(0x400)<<"}],\"writes\":[";
        for(unsigned i=0;i<core->traceCount();++i){const auto&t=core->trace()[i];if(i)out<<',';out<<"{\"cycle\":"<<(uint64_t(t.cycleHigh)<<32|t.cycleLow)<<",\"register\":"<<t.reg<<",\"value\":"<<t.value<<'}';}out<<"],\"reads\":[";
        for(unsigned i=0;i<core->sidReadTraceCount();++i){const auto&t=core->sidReadTrace()[i];if(i)out<<',';out<<"{\"cycle\":"<<(uint64_t(t.cycleHigh)<<32|t.cycleLow)<<",\"address\":"<<t.address<<",\"register\":"<<t.reg<<",\"value\":"<<t.value<<",\"error\":"<<t.error<<'}';}
        out<<"],\"writeDropped\":"<<core->droppedTrace()<<",\"readDropped\":"<<core->sidReadTraceDropped()<<",\"readCycleConvention\":\"completed SID ticks\",\"writeCycleConvention\":\"host bus start (add one)\"}";
        std::cerr<<out.str()<<'\n';return 0;
    }catch(const std::exception& error){std::cerr<<"SID8580 machine CLI error: "<<error.what()<<'\n';return 1;}
}
