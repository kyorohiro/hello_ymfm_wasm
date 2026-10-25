// SPDX-License-Identifier: BSD-3-Clause
// Standalone, device-free PCM/allocation probe. Configuration-only DAC/mute
// scenarios touch the shared Core directly; the Playground's public API remains
// fixed duty/gain1, exactly like native_pwm_create().
#include "tetorica/pwm.hpp"
#include "pwm32x_core.h"
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <string>
#include <vector>
using tetorica::pwm32x::Core;
static bool measured = false;
static uint64_t allocations = 0, frees = 0;
void *operator new(std::size_t n) { if(measured)++allocations;if(void *p=std::malloc(n))return p;throw std::bad_alloc(); }
void *operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void *p) noexcept { if(measured&&p)++frees;std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p,std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p,std::size_t) noexcept { ::operator delete(p); }
struct Event { uint32_t frame;std::string op;uint32_t a,b; };
static bool same(const NativePwmState &a,const NativePwmState &b) {return std::memcmp(&a,&b,sizeof a)==0;}
static bool tag_isolation(void *p) {
    auto state=[p](){NativePwmState s{};native_pwm_get_state(p,&s);return s;};
    auto setup=[p](uint32_t route){native_pwm_reset(p);native_pwm_write(p,0,route);native_pwm_write(p,1,2);};
    float l,r;
    setup(9); // Both FIFOs route to left. Left's third tick is latest.
    for(uint32_t i=1;i<=4;++i)native_pwm_write_tagged(p,2,100*i,i); // overflow drops tag1
    native_pwm_write_tagged(p,3,900,5);native_pwm_sample(p,&l,&r);
    if(state().left!=400||!state().left_valid)return false;
    native_pwm_cancel_tag(p,5);if(!state().left_valid||state().left!=400)return false;
    native_pwm_cancel_tag(p,4);if(state().left_valid)return false;
    setup(9); // Right's third tick is latest.
    native_pwm_write_tagged(p,2,700,10);
    for(uint32_t i=0;i<3;++i)native_pwm_write_tagged(p,3,1100+i,20+i);
    native_pwm_sample(p,&l,&r);native_pwm_cancel_tag(p,10);if(!state().left_valid||state().left!=1102)return false;
    native_pwm_cancel_tag(p,22);if(state().left_valid)return false;
    setup(9); // Same tick: right FIFO writes last.
    native_pwm_write_tagged(p,2,777,30);native_pwm_write_tagged(p,3,888,31);native_pwm_sample(p,&l,&r);
    native_pwm_cancel_tag(p,30);if(!state().left_valid||state().left!=888)return false;
    native_pwm_cancel_tag(p,31);if(state().left_valid)return false;
    setup(10); // Crossed routing retains independently owned opposite latch.
    native_pwm_write_tagged(p,2,777,40);native_pwm_write_tagged(p,3,888,41);native_pwm_sample(p,&l,&r);
    native_pwm_cancel_tag(p,40);if(state().right_valid||!state().left_valid||state().left!=888)return false;
    native_pwm_write(p,0,9); // Active timer reconfiguration empties tags, keeps latch.
    native_pwm_cancel_tag(p,41);if(state().left_valid)return false;
    setup(5);native_pwm_write(p,1,1); // Inactive: inspect exact compaction.
    native_pwm_write_tagged(p,2,100,50);native_pwm_write_tagged(p,2,200,51);native_pwm_write_tagged(p,2,300,50);
    native_pwm_write_tagged(p,3,400,51);native_pwm_cancel_tag(p,50);
    auto s=state();if(s.left_size!=1||s.left_fifo[0]!=200||s.right_size!=1||s.right_fifo[0]!=400)return false;
    if(native_pwm_has_tag(p,50)||!native_pwm_has_tag(p,51)||native_pwm_has_tag(p,0))return false;
    native_pwm_cancel_tag(p,0);if(!same(s,state()))return false;
    // Exhaustive routing/count combinations exercise the winner when multiple
    // source FIFOs share one output. Other modes still consume but never latch.
    for(uint32_t route=0;route<16;++route)for(uint32_t lc=0;lc<=3;++lc)for(uint32_t rc=0;rc<=3;++rc){
        setup(route);
        for(uint32_t i=0;i<lc;++i)native_pwm_write_tagged(p,2,100+i,100+i);
        for(uint32_t i=0;i<rc;++i)native_pwm_write_tagged(p,3,200+i,200+i);
        native_pwm_sample(p,&l,&r);s=state();
        if(route==0){ // Inactive core leaves queued inputs untouched.
            if(s.left_size!=lc||s.right_size!=rc)return false;
            continue;
        }
        uint64_t expected[2]{};
        for(uint32_t tick=0;tick<3;++tick){
            const uint32_t lm=route&3,rm=(route>>2)&3;
            if(tick<lc&&(lm==1||lm==2))expected[lm==1?0:1]=100+tick;
            if(tick<rc&&(rm==1||rm==2))expected[rm==1?1:0]=200+tick;
        }
        if(s.left_size||s.right_size)return false;
        for(uint64_t tag=100;tag<203;++tag){
            const bool wanted=tag==expected[0]||tag==expected[1];
            if(bool(native_pwm_has_tag(p,tag))!=wanted)return false;
        }
        if(expected[0]){native_pwm_cancel_tag(p,expected[0]);if(state().left_valid)return false;}
        if(expected[1]&&expected[1]!=expected[0]){native_pwm_cancel_tag(p,expected[1]);if(state().right_valid)return false;}
    }
    return true;
}
// Tag ownership uses all 64 bits and is erased by both lifecycle operations.
static bool tag_lifecycle(void *p) {
    const uint64_t first = UINT64_C(0x100000001), second = UINT64_C(0x200000001);
    auto state=[p](){NativePwmState s{};native_pwm_get_state(p,&s);return s;};
    native_pwm_reset(p); native_pwm_write(p,0,5); native_pwm_write(p,1,2);
    native_pwm_write_tagged(p,4,777,first);
    float l,r; native_pwm_sample(p,&l,&r);
    if(!native_pwm_has_tag(p,first)||native_pwm_has_tag(p,second))return false;
    native_pwm_cancel_tag(p,second); // Same low 32 bits must not cancel first.
    auto s=state();
    if(!s.left_valid||!s.right_valid||s.left!=777||s.right!=777||!native_pwm_has_tag(p,first))return false;
    native_pwm_write_tagged(p,4,888,second);
    native_pwm_stop(p);
    s=state();
    if(native_pwm_has_tag(p,first)||native_pwm_has_tag(p,second)||s.left_valid||s.right_valid||s.left_size||s.right_size)return false;
    native_pwm_write_tagged(p,4,999,second); native_pwm_sample(p,&l,&r);
    if(!native_pwm_has_tag(p,second)||l==0||r==0)return false;
    native_pwm_reset(p);
    if(native_pwm_has_tag(p,first)||native_pwm_has_tag(p,second))return false;
    // Primary writes replace tag-owned latches with unowned values.
    native_pwm_write(p,0,5);native_pwm_write(p,1,2);
    native_pwm_write_tagged(p,4,500,first);native_pwm_sample(p,&l,&r);
    native_pwm_write(p,4,600);native_pwm_sample(p,&l,&r);
    native_pwm_cancel_tag(p,first);s=state();
    if(native_pwm_has_tag(p,first)||!s.left_valid||!s.right_valid||s.left!=600||s.right!=600)return false;
    return true;
}
static bool core_state_rollback() {
    Core core(23011361,48000,1,true);
    core.write(0,5);core.write(1,1000);core.write(4,777);
    const auto before=core.state();
    for(bool left:{false,true}) {
        auto invalid=before;
        if(left)invalid.left_fifo.size=4;else invalid.right_fifo.size=4;
        if(core.load_state(invalid))return false;
        const auto &after=core.state();
        if(after.control!=before.control||after.cycle!=before.cycle||
           after.left_fifo.values!=before.left_fifo.values||after.right_fifo.values!=before.right_fifo.values||
           after.left_fifo.size!=before.left_fifo.size||after.right_fifo.size!=before.right_fifo.size||
           after.until_tick!=before.until_tick)return false;
    }
    return true;
}
int main(int argc,char **argv) {
    if(argc==2&&!std::strcmp(argv[1],"--self-test")) {
        static_assert(sizeof(NativePwmState)==96,"Native PWM state ABI changed");
        void *a=native_pwm_create(48000),*b=native_pwm_create(48000),*reference=native_pwm_create(48000);assert(a&&b&&reference);
        NativePwmState before{},after{},other{};float l=0,r=0;
        for(void *p:{a,reference}) {native_pwm_write(p,0,5);native_pwm_write(p,1,1000);native_pwm_write(p,2,700);native_pwm_write(p,3,1300);}
        measured=true;const bool tags=tag_isolation(b),lifecycle=tag_lifecycle(b),rollback=core_state_rollback();native_pwm_reset(b);
        native_pwm_get_state(b,&before);
        for(uint32_t i=0;i<4096;++i){native_pwm_get_state(a,&after);native_pwm_sample(a,&l,&r);float x,y;native_pwm_sample(reference,&x,&y);assert(l==x&&r==y);}
        native_pwm_get_state(b,&after);const bool isolated=same(before,after);
        native_pwm_get_state(a,&before);for(uint32_t i=0;i<1000;++i)native_pwm_get_state(a,&after);
        const bool read_pure=same(before,after);
        native_pwm_write(a,2,200);native_pwm_write(a,3,1600);native_pwm_set_clock(a,12000000);
        native_pwm_stop(a);native_pwm_get_state(a,&after);
        const bool stopped=after.clock==12000000&&after.registers[0]==5&&after.registers[1]==1000&&!after.left_size&&!after.right_size&&!after.left_valid&&!after.right_valid;
        for(uint32_t i=0;i<1024;++i){native_pwm_sample(a,&l,&r);assert(l==0&&r==0);}
        native_pwm_write(a,4,333);native_pwm_reset(a);native_pwm_get_state(a,&after);
        const bool reset=after.clock==12000000&&after.registers[0]==0&&after.registers[1]==0&&!after.left_size&&!after.right_size&&!after.left_valid&&!after.right_valid;
        const bool bounds=!native_pwm_set_clock(a,99999)&&!native_pwm_set_clock(a,100000001)&&native_pwm_set_clock(a,100000)&&native_pwm_set_clock(a,100000000);
        measured=false;native_pwm_destroy(a);native_pwm_destroy(b);native_pwm_destroy(reference);
        std::printf("{\"stateBytes\":%zu,\"coreHeapBytes\":%u,\"independentInstances\":%s,\"readPure\":%s,\"taggedCancellation\":%s,\"tagLifecycle64BitOwnership\":%s,\"coreStateInvalidRollback\":%s,\"stopRetainsRegistersClock\":%s,\"resetClearsFifoAndRegisters\":%s,\"clockBounds\":%s,\"renderAllocations\":%llu,\"renderFrees\":%llu}\n",sizeof(NativePwmState),native_pwm_core_size(),isolated?"true":"false",read_pure?"true":"false",tags?"true":"false",lifecycle?"true":"false",rollback?"true":"false",stopped?"true":"false",reset?"true":"false",bounds?"true":"false",(unsigned long long)allocations,(unsigned long long)frees);
        return isolated&&read_pure&&tags&&lifecycle&&rollback&&stopped&&reset&&bounds&&!allocations&&!frees?0:3;
    }
    if(argc!=3&&argc!=4)return 1;
    const bool configuration_only=argc==4&&!std::strcmp(argv[3],"--core");
    const uint32_t rate=std::strtoul(argv[1],nullptr,10),frames=std::strtoul(argv[2],nullptr,10);
    std::vector<Event> events;Event event{};while(std::cin>>event.frame>>event.op>>event.a>>event.b)events.push_back(event);
    std::vector<float> pcm(size_t(frames)*2);void *handle=native_pwm_create(rate);if(!handle)return 2;
    Core chip(23011361,rate,1,true);size_t next=0;measured=true;
    for(uint32_t frame=0;frame<frames;++frame){
        while(next<events.size()&&events[next].frame==frame){const auto &e=events[next++];
            if(e.op=="write"){if(configuration_only)chip.write(e.a,e.b);else native_pwm_write(handle,e.a,e.b);}
            else if(e.op=="clock"){if(configuration_only)chip.set_clock(e.a);else assert(native_pwm_set_clock(handle,e.a));}
            else if(e.op=="reset"){if(configuration_only)chip.reset();else native_pwm_reset(handle);}
            else if(e.op=="stop")native_pwm_stop(handle);
            else if(e.op=="mute"){assert(configuration_only);chip.set_muted(e.a!=0);}
            else if(e.op=="mode"){assert(configuration_only);chip.set_output_mode(e.a!=0);}
            else if(e.op=="read"){NativePwmState state{};native_pwm_get_state(handle,&state);}
            else return 6;
        }
        if(configuration_only)chip.sample(pcm[frame*2],pcm[frame*2+1]);else native_pwm_sample(handle,&pcm[frame*2],&pcm[frame*2+1]);
    }
    measured=false;native_pwm_destroy(handle);if(allocations||frees)return 4;
    if(std::fwrite(pcm.data(),sizeof(float),pcm.size(),stdout)!=pcm.size())return 5;return 0;
}
