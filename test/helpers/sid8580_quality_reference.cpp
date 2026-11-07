// SPDX-License-Identifier: BSD-3-Clause
// External-only GPL executable when linked to pinned libresidfp. No PSID/C64,
// private SID getters, fitted gain/DC/phase or audio device.
// stdin: SID8QUALITY 1 RATE MODEL; w REG BYTE / r REG / c N / skip N / reset / stop.
// Actual SID clock(1) generates one chip-rate sample, then a separate rational
// host phase selects the same completed ticks as the candidate sampler.
// stdout: captured PCM16LE only. stderr: one JSON metadata object.
#include <residfp/residfp.h>
#include <array>
#include <cstdint>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
constexpr uint64_t clockHz=985248, maximumCycles=60*clockHz;
constexpr size_t maximumInputBytes=1024*1024;
void check(bool condition,const char* message) {if(!condition)throw std::runtime_error(message);}
uint64_t number(const std::string& text,uint64_t maximum) {
    check(!text.empty(),"Missing unsigned decimal integer");uint64_t value=0;
    for(unsigned char ch:text) {
        check(ch>='0'&&ch<='9',"Expected unsigned decimal integer");const unsigned digit=ch-'0';
        check(digit<=maximum&&value<=(maximum-digit)/10,"Integer exceeds limit");value=value*10+digit;
    }
    return value;
}
bool line(std::string& result,size_t& bytes) {
    result.clear();char ch;
    while(std::cin.get(ch)) {
        check(++bytes<=maximumInputBytes,"Protocol exceeds one MiB");
        if(ch=='\n')return true;
        const unsigned char byte=static_cast<unsigned char>(ch);
        check((byte>=32&&byte<=126)||ch=='\t'||ch=='\r',"Protocol must be ASCII");
        check(result.size()<128,"Protocol line exceeds 128 bytes");result.push_back(ch);
    }
    check(!std::cin.bad(),"Could not read protocol");return !result.empty();
}
enum class Kind {Write,Read,Capture,Skip,Reset,Stop};
struct Command {Kind kind;uint64_t first=0,second=0;};
struct Read {uint64_t cycle;unsigned reg,value;};
struct Range {
    uint64_t startCycle,endCycle,startFrame,endFrame,captureOffset,frames,firstSampleCycle,lastSampleCycle;
};
}
int main(int argc,char**) {
    try {
        check(argc==1,"SID8QUALITY takes its protocol on stdin");
        static_assert(sizeof(short)==2&&std::numeric_limits<short>::is_signed,"PCM16 short required");
        size_t inputBytes=0;std::string text,magic,version,rateText,modelText,extra;
        check(line(text,inputBytes),"Missing SID8QUALITY header");
        std::istringstream header(text);
        check(static_cast<bool>(header>>magic>>version>>rateText>>modelText)&&!(header>>extra),"Expected SID8QUALITY 1 RATE MODEL");
        check(magic=="SID8QUALITY"&&version=="1","Unsupported quality protocol/version");
        const unsigned rate=static_cast<unsigned>(number(rateText,96000));check(rate>=8000,"Rate must be 8000..96000");
        const unsigned model=static_cast<unsigned>(number(modelText,8580));check(model==6581||model==8580,"Model must be 6581 or 8580");
        std::vector<Command> commands;uint64_t requestedCycles=0;
        // Reject malformed tail commands before any chip state or output exists.
        while(line(text,inputBytes)) {
            std::istringstream input(text);std::string operation,first,second;
            if(!(input>>operation)||operation[0]=='#')continue;
            if(operation=="w") {
                check(static_cast<bool>(input>>first>>second)&&!(input>>extra),"Expected w REGISTER BYTE");
                commands.push_back({Kind::Write,number(first,31),number(second,255)});
            } else if(operation=="r") {
                check(static_cast<bool>(input>>first)&&!(input>>extra),"Expected r REGISTER");
                commands.push_back({Kind::Read,number(first,31)});
            } else if(operation=="c"||operation=="skip") {
                check(static_cast<bool>(input>>first)&&!(input>>extra),"Expected c/skip CYCLES");
                const auto count=number(first,maximumCycles);check(count<=maximumCycles-requestedCycles,"Requested duration exceeds 60 PAL seconds");
                requestedCycles+=count;commands.push_back({operation=="c"?Kind::Capture:Kind::Skip,count});
            } else if(operation=="reset"||operation=="stop") {
                check(!(input>>extra),"reset/stop takes no arguments");commands.push_back({operation=="reset"?Kind::Reset:Kind::Stop});
            } else throw std::runtime_error("Unknown quality command");
        }
        reSIDfp::residfp sid;
        check(sid.setChipModel(model==6581?reSIDfp::MOS6581:reSIDfp::CSG8580),"Reference model rejected");
        check(sid.setCombinedWaveforms(reSIDfp::AVERAGE),"Reference combined waveforms rejected");
        // Public API only. At equal chip/output rates DECIMATE returns exactly
        // one short per completed clock. Never use clockSilent/clockDigital.
        check(sid.setSamplingParameters(clockHz,reSIDfp::DECIMATE,clockHz),"Reference rejected chip-rate sampling");
        sid.input(0);sid.reset();
        uint64_t cycles=0,generatedFrames=0,capturedFrames=0,discardedFrames=0;
        uint64_t epochCycles=0,epochFrames=0,captureCycles=0,skippedCycles=0,referenceSamples=0,resets=0;
        uint32_t phase=0;bool stopped=false;
        std::array<unsigned char,16384> output{};size_t buffered=0;
        std::array<unsigned char,32> registers{};std::vector<Read> reads;std::vector<Range> ranges;
        auto flush=[&]() {
            if(buffered)std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(buffered));
            check(static_cast<bool>(std::cout),"Could not write captured PCM");buffered=0;
        };
#ifdef _WIN32
        check(_setmode(_fileno(stdout),_O_BINARY)!=-1,"Could not set binary stdout");
#endif
        for(const auto& command:commands) {
            if(command.kind==Kind::Write) {sid.write(static_cast<int>(command.first),static_cast<unsigned char>(command.second));registers[command.first]=static_cast<unsigned char>(command.second);}
            else if(command.kind==Kind::Read) reads.push_back({cycles,static_cast<unsigned>(command.first),sid.read(static_cast<int>(command.first))});
            else if(command.kind==Kind::Reset) {sid.reset();registers.fill(0);phase=0;epochCycles=0;epochFrames=0;stopped=false;++resets;}
            else if(command.kind==Kind::Stop) {sid.reset();registers.fill(0);stopped=true;}
            else {
                const bool capture=command.kind==Kind::Capture;
                const auto startCycle=cycles,startFrame=generatedFrames,captureOffset=capturedFrames;
                uint64_t firstSampleCycle=0,lastSampleCycle=0;
                if(!stopped)for(uint64_t tick=0;tick<command.first;++tick) {
                    short sample[4]{};const int count=sid.clock(1u,sample);
                    check(count==1,"Chip-rate reference must generate exactly one sample per tick");
                    ++cycles;++epochCycles;++referenceSamples;
                    if(capture)++captureCycles;else ++skippedCycles;
                    phase+=rate;
                    if(phase>=clockHz) {
                        phase-=clockHz;++generatedFrames;++epochFrames;
                        if(capture) {
                            if(firstSampleCycle==0)firstSampleCycle=cycles;lastSampleCycle=cycles;
                            const auto bits=static_cast<uint16_t>(sample[0]);
                            output[buffered++]=static_cast<unsigned char>(bits);output[buffered++]=static_cast<unsigned char>(bits>>8);
                            ++capturedFrames;if(buffered==output.size())flush();
                        } else ++discardedFrames;
                    }
                }
                if(capture)ranges.push_back({startCycle,cycles,startFrame,generatedFrames,captureOffset,
                    generatedFrames-startFrame,firstSampleCycle,lastSampleCycle});
            }
        }
        flush();std::cout.flush();check(static_cast<bool>(std::cout),"Could not flush captured PCM");
        check(capturedFrames+discardedFrames==generatedFrames&&referenceSamples==cycles,"Sample/cycle accounting differs");
        std::cerr<<"{\"format\":\"tetorica-sid8580-quality-reference\",\"version\":1,\"model\":"<<model
                 <<",\"sampleRate\":"<<rate<<",\"clockHz\":"<<clockHz
                 <<",\"cycles\":"<<cycles<<",\"frames\":"<<capturedFrames
                 <<",\"globalCycles\":"<<cycles<<",\"globalFrames\":"<<generatedFrames
                 <<",\"generatedFrames\":"<<generatedFrames<<",\"allSampleFrames\":"<<generatedFrames
                 <<",\"capturedFrames\":"<<capturedFrames<<",\"discardedFrames\":"<<discardedFrames
                 <<",\"epochCycles\":"<<epochCycles<<",\"epochFrames\":"<<epochFrames
                 <<",\"requestedCycles\":"<<requestedCycles<<",\"captureCycles\":"<<captureCycles<<",\"skippedCycles\":"<<skippedCycles
                 <<",\"stopped\":"<<(stopped?"true":"false")<<",\"resets\":"<<resets<<",\"error\":0"
                 <<",\"pcmFormat\":\"signed16le\",\"sampler\":{\"referenceMethod\":\"DECIMATE\",\"referenceRate\":"<<clockHz
                 <<",\"referenceSamples\":"<<referenceSamples<<",\"targetRate\":"<<rate
                 <<",\"hostClock\":"<<clockHz<<",\"phase\":"<<phase
                 <<",\"initialPhase\":0,\"rule\":\"phase+=targetRate; emit iff phase>=clock; phase-=clock\",\"tickBoundary\":\"completed ticks\",\"automaticWarmupOrCorrection\":false}"
                 <<",\"reads\":[";
        for(size_t i=0;i<reads.size();++i)std::cerr<<(i?",":"")<<reads[i].value;
        std::cerr<<"],\"readEvents\":[";
        for(size_t i=0;i<reads.size();++i) {const auto& event=reads[i];std::cerr<<(i?",":"")<<"{\"cycle\":"<<event.cycle<<",\"register\":"<<event.reg<<",\"value\":"<<event.value<<"}";}
        std::cerr<<"],\"captureRanges\":[";
        for(size_t i=0;i<ranges.size();++i) {
            const auto& range=ranges[i];std::cerr<<(i?",":"")<<"{\"startCycle\":"<<range.startCycle<<",\"endCycle\":"<<range.endCycle
                <<",\"startFrame\":"<<range.startFrame<<",\"endFrame\":"<<range.endFrame<<",\"captureOffset\":"<<range.captureOffset
                <<",\"frames\":"<<range.frames<<",\"firstSampleCycle\":";
            if(range.frames)std::cerr<<range.firstSampleCycle;else std::cerr<<"null";
            std::cerr<<",\"lastSampleCycle\":";if(range.frames)std::cerr<<range.lastSampleCycle;else std::cerr<<"null";std::cerr<<"}";
        }
        std::cerr<<"],\"registers\":[";
        for(size_t i=0;i<registers.size();++i)std::cerr<<(i?",":"")<<static_cast<unsigned>(registers[i]);
        std::cerr<<"]}\n";return 0;
    } catch(const std::exception& error) {
        std::cerr<<"{\"error\":\"SID8QUALITY rejected input or failed execution\",\"detail\":\"";
        for(char ch:std::string(error.what())) {if(ch=='"'||ch=='\\')std::cerr<<'\\';if(static_cast<unsigned char>(ch)>=32&&static_cast<unsigned char>(ch)<=126)std::cerr<<ch;}
        std::cerr<<"\"}\n";return 1;
    }
}
