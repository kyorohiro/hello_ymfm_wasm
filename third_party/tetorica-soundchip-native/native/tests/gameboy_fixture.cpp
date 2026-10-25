// SPDX-License-Identifier: BSD-3-Clause
// Offline only: no output device is constructed or opened.
#include <tetorica/gameboy.hpp>
#include <atomic>
#include <cassert>
#include <cstddef>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <string>
#include <vector>

static bool measured = false;
static uint64_t allocations = 0, deallocations = 0;
void *operator new(std::size_t size) { if (measured) ++allocations; if (void *p=std::malloc(size)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void *p) noexcept { if (measured && p) ++deallocations;std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p,std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p,std::size_t) noexcept { ::operator delete(p); }
struct Event { uint32_t frame; std::string op; uint32_t address,value; };
static void program(void *chip, uint32_t period) {
    native_gameboy_write(chip,22,128);native_gameboy_write(chip,20,0x77);native_gameboy_write(chip,21,0xff);
    native_gameboy_write(chip,1,0x80);native_gameboy_write(chip,2,0xa0);native_gameboy_write(chip,3,period&255);native_gameboy_write(chip,4,128|(period>>8));
}
static_assert(sizeof(NativeGameboyState) == 60, "Reference C ABI size");
static_assert(offsetof(NativeGameboyState, active_mask) == 48, "Reference active mask offset");
static_assert(offsetof(NativeGameboyState, clock) == 52, "Reference clock offset");
static_assert(offsetof(NativeGameboyState, source_mute_mask) == 56, "Reference mute mask offset");

static void program_voices(void *chip, uint8_t omitted) {
    native_gameboy_write(chip, 22, 0x80);
    native_gameboy_write(chip, 20, 0x37);
    native_gameboy_write(chip, 21, 0xa5);
    for (uint8_t i = 0; i < 16; ++i) native_gameboy_write(chip, 32 + i, uint8_t(i * 17));
    const uint8_t registers[4][5] = {
        {0x00, 0x80, 0xa0, 0xd6, 0x86},
        {0x00, 0x40, 0xc0, 0x6c, 0x87},
        {0x80, 0x00, 0x20, 0x42, 0x87},
        {0x00, 0x00, 0xf0, 0x35, 0x80},
    };
    for (uint8_t channel = 0; channel < 4; ++channel) {
        for (uint8_t reg = 0; reg < 5; ++reg) {
            uint8_t value = registers[channel][reg];
            if (channel == omitted && reg == 4) value &= 0x7f;
            native_gameboy_write(chip, channel * 5 + reg, value);
        }
    }
}

static void extended_self_test() {
    for (uint32_t rate : {1u, 384000u}) {
        void *chip = native_gameboy_create(rate);
        assert(chip);
        native_gameboy_destroy(chip);
    }
    const uint8_t dmgWave[16] = {
        0xac, 0xdd, 0xda, 0x48, 0x36, 0x02, 0xcf, 0x16,
        0x2c, 0x04, 0xe5, 0x2c, 0xac, 0xdd, 0xda, 0x48,
    };
    for (uint32_t rate : {44100u, 48000u, 96000u}) {
        for (uint32_t clock : {100000u, 4194304u, 100000000u}) {
            for (uint8_t stopped = 0; stopped < 4; ++stopped) {
                void *chip = native_gameboy_create(rate), *reference = native_gameboy_create(rate);
                assert(chip && reference);
                measured = true;
                program_voices(chip, 255);
                program_voices(reference, stopped);
                assert(native_gameboy_set_clock(chip, clock));
                assert(native_gameboy_set_clock(reference, clock));
                NativeGameboyState before{}, after{};
                native_gameboy_get_state(chip, &before);
                assert(before.active_mask == 15 && before.clock == clock);
                assert(before.registers[20] == 0x37 && before.registers[21] == 0xa5);
                for (uint8_t ch = 0; ch < 4; ++ch) assert(!(before.registers[ch * 5 + 4] & 0x80));
                native_gameboy_write(chip, 48, 0xff);
                native_gameboy_write(chip, 255, 0xff);
                native_gameboy_stop_channel(chip, 4);
                native_gameboy_stop_channel(chip, 255);
                assert(!native_gameboy_set_clock(chip, 99999));
                assert(!native_gameboy_set_clock(chip, 100000001));
                native_gameboy_get_state(chip, &after);
                assert(!std::memcmp(&before, &after, sizeof before));
                float l, r, rl, rr;
                for (uint32_t i = 0; i < 173; ++i) {
                    native_gameboy_sample(chip, &l, &r);
                    native_gameboy_sample(reference, &rl, &rr);
                    assert(std::isfinite(l) && std::isfinite(r) && std::isfinite(rl) && std::isfinite(rr));
                }
                native_gameboy_get_state(chip, &before);
                native_gameboy_stop_channel(chip, stopped);
                native_gameboy_get_state(chip, &after);
                assert(after.active_mask == (15u & ~(1u << stopped)));
                assert(!std::memcmp(before.registers, after.registers, 22));
                assert(!std::memcmp(before.registers + 23, after.registers + 23, 25));
                assert(after.clock == before.clock && after.source_mute_mask == before.source_mute_mask);
                // A sub-base outer resampler retains its previous output until
                // the next source sample. Once advanced, the foreign voices
                // exactly match a core where this voice was never triggered.
                const uint32_t heldFrames = uint32_t(std::ceil(4194304.0 / clock));
                double energy = 0;
                for (uint32_t i = 0; i < 1024; ++i) {
                    native_gameboy_get_state(chip, &before);
                    native_gameboy_get_state(chip, &after);
                    assert(!std::memcmp(&before, &after, sizeof before));
                    native_gameboy_sample(chip, &l, &r);
                    native_gameboy_sample(reference, &rl, &rr);
                    assert(std::isfinite(l) && std::isfinite(r) && std::isfinite(rl) && std::isfinite(rr));
                    if (i >= heldFrames) assert(l == rl && r == rr);
                    energy += std::abs(rl) + std::abs(rr);
                }
                assert(energy > 1);
                native_gameboy_get_state(chip, &before);
                native_gameboy_stop(chip);
                native_gameboy_get_state(chip, &after);
                assert(after.active_mask == 0 && after.registers[22] == 0x80);
                assert(!std::memcmp(before.registers, after.registers, 22));
                assert(!std::memcmp(before.registers + 23, after.registers + 23, 25));
                for (uint32_t i = 0; i < heldFrames + 2; ++i) {
                    native_gameboy_sample(chip, &l, &r);
                    assert(l == 0 && r == 0);
                }
                native_gameboy_set_mute_mask(chip, 0xfffffff5);
                native_gameboy_reset(chip);
                native_gameboy_get_state(chip, &after);
                assert(after.active_mask == 0 && after.clock == clock && after.source_mute_mask == 5);
                assert(!std::memcmp(after.registers + 32, dmgWave, sizeof dmgWave));
                native_gameboy_sample(chip, &l, &r);
                assert(l == 0 && r == 0);
                measured = false;
                assert(!allocations && !deallocations);
                native_gameboy_destroy(chip);
                native_gameboy_destroy(reference);
            }
        }
    }
    for (uint32_t rate : {44100u, 48000u, 96000u}) {
        void *chip = native_gameboy_create(rate);
        assert(chip);
        measured = true;
        program(chip, 1750);
        assert(native_gameboy_set_clock(chip, 2097152));
        float l = 0, r = 0;
        for (uint32_t i = 0; i < 256 && l == 0 && r == 0; ++i) {
            native_gameboy_sample(chip, &l, &r);
            native_gameboy_sample(chip, &l, &r);
        }
        assert(l != 0 || r != 0);
        const float heldLeft = l, heldRight = r;
        native_gameboy_stop_channel(chip, 0);
        native_gameboy_sample(chip, &l, &r);
        assert(l == heldLeft && r == heldRight); // Outer half-clock held frame.
        native_gameboy_sample(chip, &l, &r);
        assert(l == 0 && r == 0); // The following source frame is silent.
        program(chip, 1750);
        for (uint32_t i = 0; i < 256 && l == 0 && r == 0; ++i) {
            native_gameboy_sample(chip, &l, &r);
            native_gameboy_sample(chip, &l, &r);
        }
        assert(l != 0 || r != 0);
        native_gameboy_stop(chip);
        native_gameboy_sample(chip, &l, &r);
        assert(l == 0 && r == 0); // Global Stop also clears the outer held frame.
        measured = false;
        assert(!allocations && !deallocations);
        native_gameboy_destroy(chip);
    }
}
int main(int argc,char **argv) {
    if (argc == 2 && !std::strcmp(argv[1],"--self-test")) {
        extended_self_test();
        void *chip=native_gameboy_create(48000),*second=native_gameboy_create(48000),*twin=native_gameboy_create(48000);if(!chip||!second||!twin)return 2;
        NativeGameboyState state{};
        measured=true;
        native_gameboy_write(chip,22,128);native_gameboy_write(chip,20,0x77);native_gameboy_write(chip,21,0xff);
        native_gameboy_write(chip,1,0x80);native_gameboy_write(chip,2,0xa0);native_gameboy_write(chip,3,0x22);native_gameboy_write(chip,4,0x87);
        native_gameboy_write(chip,32,0x12);native_gameboy_write(chip,33,0x34);
        native_gameboy_set_clock(chip,2097152);
        float l=0,r=0;for(unsigned i=0;i<10000;++i)native_gameboy_sample(chip,&l,&r);
        native_gameboy_stop(chip);native_gameboy_get_state(chip,&state);
        const bool stopped=state.active_mask==0&&state.registers[2]==0xa0&&state.registers[32]==0x12&&state.registers[33]==0x34&&state.clock==2097152&&(state.registers[22]&128);
        native_gameboy_reset(chip);native_gameboy_get_state(chip,&state);
        const bool reset=state.active_mask==0&&state.registers[2]==0&&state.registers[32]==0xac&&state.clock==2097152;
        const bool bounds=!native_gameboy_set_clock(chip,99999)&&!native_gameboy_set_clock(chip,100000001);
        native_gameboy_set_clock(chip,4194304);program(chip,1750);program(second,1900);program(twin,1750);
        native_gameboy_write(second,32,0x45);native_gameboy_set_clock(second,8388608);
        NativeGameboyState before{},after{},other{};native_gameboy_get_state(chip,&before);native_gameboy_get_state(second,&other);
        const bool isolation=before.registers[3]!=other.registers[3]&&before.registers[32]!=other.registers[32]&&before.clock==4194304&&other.clock==8388608;
        for(unsigned i=0;i<200;++i)native_gameboy_get_state(chip,&after);
        bool observation=!std::memcmp(&before,&after,sizeof before);
        float tl=0,tr=0;for(unsigned i=0;i<8192;++i){native_gameboy_sample(chip,&l,&r);native_gameboy_sample(twin,&tl,&tr);observation=observation&&l==tl&&r==tr;}
        native_gameboy_get_state(chip,&before);native_gameboy_set_mute_mask(chip,0xff);native_gameboy_get_state(chip,&after);
        bool mute=after.source_mute_mask==15&&before.active_mask==after.active_mask&&!std::memcmp(before.registers,after.registers,48);
        for(unsigned i=0;i<4096;++i){native_gameboy_sample(chip,&l,&r);native_gameboy_sample(twin,&tl,&tr);mute=mute&&l==0&&r==0;}
        native_gameboy_set_mute_mask(chip,0);for(unsigned i=0;i<4096;++i){native_gameboy_sample(chip,&l,&r);native_gameboy_sample(twin,&tl,&tr);mute=mute&&l==tl&&r==tr;}
        native_gameboy_set_mute_mask(chip,4);native_gameboy_reset(chip);native_gameboy_get_state(chip,&after);mute=mute&&after.source_mute_mask==4;
        native_gameboy_reset(chip);native_gameboy_set_mute_mask(chip,0);program(chip,1750);
        native_gameboy_write(chip,6,0x40);native_gameboy_write(chip,7,0xa0);native_gameboy_write(chip,8,0x70);native_gameboy_write(chip,9,0x87);
        native_gameboy_get_state(chip,&before);native_gameboy_stop_channel(chip,0);native_gameboy_get_state(chip,&after);
        const bool channelStop=(before.active_mask&3)==3&&(after.active_mask&3)==2&&!std::memcmp(before.registers,after.registers,22)&&after.clock==before.clock;
        measured=false;native_gameboy_destroy(chip);native_gameboy_destroy(second);native_gameboy_destroy(twin);
        const bool invalidRates=!native_gameboy_create(0)&&!native_gameboy_create(384001);
        std::fprintf(stderr,"{\"stopRetainsVoiceRamClock\":%s,\"resetUsesDmgWavePattern\":%s,\"bounds\":%s,\"independentInstances\":%s,\"readOnlyObservation\":%s,\"sourceMutePreservesPhaseRegistersAndReset\":%s,\"individualChannelStop\":%s,\"invalidRates\":%s,\"allocationsDuringRender\":%llu,\"freesDuringRender\":%llu}\n",stopped?"true":"false",reset?"true":"false",bounds?"true":"false",isolation?"true":"false",observation?"true":"false",mute?"true":"false",channelStop?"true":"false",invalidRates?"true":"false",(unsigned long long)allocations,(unsigned long long)deallocations);
        return stopped&&reset&&bounds&&isolation&&observation&&mute&&channelStop&&invalidRates&&!allocations&&!deallocations?0:3;
    }
    if(argc!=3)return 1;
    const uint32_t rate=std::strtoul(argv[1],nullptr,10),frames=std::strtoul(argv[2],nullptr,10);
    std::vector<Event> events;Event event{};
    while(std::cin>>event.frame>>event.op>>event.address>>event.value)events.push_back(event);
    std::vector<float> output(size_t(frames)*2);
    void *chip=native_gameboy_create(rate);if(!chip)return 2;
    size_t index=0;measured=true;
    for(uint32_t frame=0;frame<frames;++frame){
        while(index<events.size()&&events[index].frame==frame){const auto&e=events[index++];
            if(e.op=="write")native_gameboy_write(chip,e.address,e.value);
            else if(e.op=="clock")native_gameboy_set_clock(chip,e.value);
            else if(e.op=="reset")native_gameboy_reset(chip);
            else if(e.op=="stop")native_gameboy_stop(chip);
            else if(e.op=="stop-channel")native_gameboy_stop_channel(chip,e.address);
            else if(e.op=="mute")native_gameboy_set_mute_mask(chip,e.value);
        }
        native_gameboy_sample(chip,&output[frame*2],&output[frame*2+1]);
    }
    measured=false;native_gameboy_destroy(chip);
    if(allocations||deallocations){std::fprintf(stderr,"Callback allocation audit failed: %llu/%llu\n",(unsigned long long)allocations,(unsigned long long)deallocations);return 4;}
    if(std::fwrite(output.data(),sizeof(float),output.size(),stdout)!=output.size())return 5;
    return 0;
}
