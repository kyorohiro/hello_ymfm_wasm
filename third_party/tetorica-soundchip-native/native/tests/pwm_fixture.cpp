// SPDX-License-Identifier: BSD-3-Clause
// Offline only: no output device is constructed or opened.
#include "tetorica/pwm.hpp"
#include <atomic>
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
// Additional standalone boundary checks leave the original PCM CLI untouched.
static bool construction_contract() {
    if (native_pwm_create(0) || native_pwm_create(1000001)) return false;
    for (uint32_t rate : {1u, 48000u, 1000000u}) {
        void *chip = native_pwm_create(rate);
        if (!chip) return false;
        NativePwmState state{};
        native_pwm_get_state(chip, &state);
        float l = 1, r = 1;
        native_pwm_sample(chip, &l, &r);
        const bool valid = state.clock == 23011361 && !state.cycle &&
            !state.left_valid && !state.right_valid &&
            state.registers[2] == 0x4000 && state.registers[3] == 0x4000 &&
            state.registers[4] == 0x4000 && l == 0 && r == 0;
        native_pwm_destroy(chip);
        if (!valid) return false;
    }
    return true;
}
static bool fifo_timer_contract(void *chip) {
    auto state = [chip]() { NativePwmState s{}; native_pwm_get_state(chip, &s); return s; };
    native_pwm_reset(chip);
    native_pwm_write(chip, 0, 5);
    native_pwm_write(chip, 1, 1); // Disabled timer permits exact FIFO observation.
    native_pwm_write(chip, 4, 0x12345);
    auto s = state();
    if (s.left_fifo[0] != 0x2345 || s.right_fifo[0] != 0x2345 ||
        s.left_size != 1 || s.right_size != 1 || s.registers[4] != 0) return false;
    native_pwm_write(chip, 2, 200);
    native_pwm_write(chip, 2, 300);
    native_pwm_write(chip, 2, 400); // Capacity is three: discard the oldest.
    s = state();
    if (s.left_size != 3 || s.left_fifo[0] != 200 || s.left_fifo[1] != 300 ||
        s.left_fifo[2] != 400 || s.registers[2] != 0x8000 ||
        s.registers[3] != 0 || s.registers[4] != 0) return false;
    const auto before = s;
    native_pwm_write(chip, 5, 0xffffffff);
    native_pwm_write(chip, 0xffffffff, 123);
    s = state();
    if (std::memcmp(&before, &s, sizeof before)) return false;
    if (native_pwm_set_clock(chip, 99999) || native_pwm_set_clock(chip, 100000001)) return false;
    s = state();
    if (std::memcmp(&before, &s, sizeof s)) return false;
    if (!native_pwm_set_clock(chip, 48000000)) return false;
    s = state();
    auto expected = before; expected.clock = 48000000;
    if (std::memcmp(&expected, &s, sizeof s)) return false;
    // Exactly one tick per frame, including the first delayed latch update.
    native_pwm_write(chip, 0, 0x105);
    native_pwm_write(chip, 1, 1001);
    native_pwm_write(chip, 2, 700);
    native_pwm_write(chip, 3, 1300);
    float l = 1, r = 1;
    native_pwm_sample(chip, &l, &r);
    s = state();
    if (l != 0 || r != 0 || s.left != 700 || s.right != 1300 ||
        !s.left_valid || !s.right_valid || s.left_size || s.right_size ||
        s.interrupt_count != 1 || s.timer_tick || s.until_tick != 1000) return false;
    native_pwm_sample(chip, &l, &r);
    if (l != float(700 / 500.5 - 1) || r != float(1300 / 500.5 - 1)) return false;
    const auto held = state();
    if (held.left != 700 || held.right != 1300 || held.interrupt_count != 2) return false;
    native_pwm_stop(chip);
    s = state();
    if (s.registers[0] != held.registers[0] || s.registers[1] != held.registers[1] ||
        s.clock != held.clock || s.cycle != held.cycle || s.timer_tick != held.timer_tick ||
        s.interrupt_count != held.interrupt_count || s.until_tick != held.until_tick ||
        s.left || s.right || s.left_valid || s.right_valid || s.left_size || s.right_size) return false;
    native_pwm_reset(chip);
    s = state();
    if (s.clock != 48000000 || s.registers[0] || s.registers[1] || s.cycle ||
        s.left || s.right || s.left_valid || s.right_valid || s.left_size || s.right_size ||
        s.timer_tick || s.interrupt_count || s.until_tick) return false;
    for (unsigned i = 0; i < 3; ++i) if (s.left_fifo[i] || s.right_fifo[i]) return false;
    return true;
}
int main(int argc,char **argv) {
    if (argc == 2 && !std::strcmp(argv[1],"--self-test")) {
        const bool constructors=construction_contract();
        void *chip=native_pwm_create(48000);if(!chip)return 2;
        NativePwmState state{};
        measured=true;
        const bool fifo_timer=fifo_timer_contract(chip);
        native_pwm_reset(chip);
        native_pwm_write(chip,0,5);native_pwm_write(chip,1,1000);native_pwm_write(chip,4,300);
        native_pwm_set_clock(chip,12000000);
        float l=0,r=0;for(unsigned i=0;i<10000;++i)native_pwm_sample(chip,&l,&r);
        native_pwm_stop(chip);native_pwm_get_state(chip,&state);
        const bool stopped=state.left_valid==0&&state.right_valid==0&&state.left_size==0&&state.right_size==0&&state.registers[0]==5&&state.registers[1]==1000&&state.clock==12000000;
        native_pwm_reset(chip);native_pwm_get_state(chip,&state);
        const bool reset=state.registers[0]==0&&state.registers[1]==0&&state.clock==12000000;
        const bool bounds=!native_pwm_set_clock(chip,99999)&&!native_pwm_set_clock(chip,100000001);
        measured=false;native_pwm_destroy(chip);
        std::fprintf(stderr,"{\"constructorBoundsDefaults\":%s,\"fifoTimerAndInvalidRollback\":%s,\"stopRetainsRoutingCycleClock\":%s,\"resetClearsRegisters\":%s,\"bounds\":%s,\"allocationsDuringRender\":%llu,\"freesDuringRender\":%llu}\n",constructors?"true":"false",fifo_timer?"true":"false",stopped?"true":"false",reset?"true":"false",bounds?"true":"false",(unsigned long long)allocations,(unsigned long long)deallocations);
        return constructors&&fifo_timer&&stopped&&reset&&bounds&&!allocations&&!deallocations?0:3;
    }
    if(argc!=3)return 1;
    const uint32_t rate=std::strtoul(argv[1],nullptr,10),frames=std::strtoul(argv[2],nullptr,10);
    std::vector<Event> events;Event event{};
    while(std::cin>>event.frame>>event.op>>event.address>>event.value)events.push_back(event);
    std::vector<float> output(size_t(frames)*2);
    void *chip=native_pwm_create(rate);if(!chip)return 2;
    size_t index=0;measured=true;
    for(uint32_t frame=0;frame<frames;++frame){
        while(index<events.size()&&events[index].frame==frame){const auto&e=events[index++];
            if(e.op=="write")native_pwm_write(chip,e.address,e.value);
            else if(e.op=="clock")native_pwm_set_clock(chip,e.value);
            else if(e.op=="reset")native_pwm_reset(chip);
            else if(e.op=="stop")native_pwm_stop(chip);
        }
        native_pwm_sample(chip,&output[frame*2],&output[frame*2+1]);
    }
    measured=false;native_pwm_destroy(chip);
    if(allocations||deallocations){std::fprintf(stderr,"Callback allocation audit failed: %llu/%llu\n",(unsigned long long)allocations,(unsigned long long)deallocations);return 4;}
    if(std::fwrite(output.data(),sizeof(float),output.size(),stdout)!=output.size())return 5;
    return 0;
}
