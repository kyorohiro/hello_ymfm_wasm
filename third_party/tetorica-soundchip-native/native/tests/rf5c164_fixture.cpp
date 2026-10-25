// Offline additional RF5C164 DSP/source-isolation fixture. No device.
#include <tetorica/rf5c164.hpp>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <sstream>
#include <string>
#include <vector>
static bool audit=false;static uint64_t allocations=0,frees=0;
void*operator new(std::size_t n){if(audit)++allocations;if(void*p=std::malloc(n))return p;throw std::bad_alloc();}void*operator new[](std::size_t n){return ::operator new(n);}
void operator delete(void*p)noexcept{if(audit&&p)++frees;std::free(p);}void operator delete[](void*p)noexcept{::operator delete(p);}void operator delete(void*p,std::size_t)noexcept{::operator delete(p);}void operator delete[](void*p,std::size_t)noexcept{::operator delete(p);}
static uint8_t pattern(uint32_t i,uint32_t seed){return uint8_t((i*seed+17)%254);}
static void voice(void*p,uint8_t ch){native_extra_rf5c164_write(p,7,0xc0|ch);for(uint8_t reg=0;reg<7;++reg)native_extra_rf5c164_write(p,reg,reg==0?255:reg==1?255:reg==2?uint8_t(17+ch*29):reg==3?8:0);NativeExtraRf5c164State s{};native_extra_rf5c164_get_state(p,&s);native_extra_rf5c164_write(p,8,s.mask&~(1u<<ch));}
static void next(void*p,float&l,float&r){native_extra_rf5c164_sample(p,&l,&r);assert(std::isfinite(l)&&std::isfinite(r));}
struct Pair {
    void *primary, *extra;
    explicit Pair(uint32_t rate) : primary(native_rf5c164_create(rate)), extra(native_extra_rf5c164_create(rate)) { assert(primary && extra); }
    ~Pair() { native_rf5c164_destroy(primary); native_extra_rf5c164_destroy(extra); }
    void write(uint8_t reg, uint8_t value) { native_rf5c164_write(primary, reg, value); native_extra_rf5c164_write(extra, reg, value); }
    void memory(uint16_t offset, uint8_t value) { native_rf5c164_write_memory(primary, offset, value); native_extra_rf5c164_write_memory(extra, offset, value); }
    void load(const uint8_t *data, uint32_t offset, uint32_t size) { assert(native_rf5c164_load(primary, data, offset, size)); assert(native_extra_rf5c164_load(extra, data, offset, size)); }
    void reset() { native_rf5c164_reset(primary); native_extra_rf5c164_reset(extra); }
    void clock(uint32_t hz) { native_rf5c164_set_clock(primary, hz); assert(native_extra_rf5c164_set_clock(extra, hz)); }
    double compare(uint32_t frames) {
        double energy = 0;
        for (uint32_t i = 0; i < frames; ++i) {
            NativeExtraRf5c164State before{}, after{}; native_extra_rf5c164_get_state(extra, &before);
            for (int j = 0; j < 3; ++j) native_extra_rf5c164_get_state(extra, &after);
            assert(!std::memcmp(&before, &after, sizeof before));
            float pl, pr, el, er; native_rf5c164_sample(primary, &pl, &pr); next(extra, el, er);
            assert(std::isfinite(pl) && std::isfinite(pr) && pl == el && pr == er);
            energy += std::abs(pl) + std::abs(pr);
        }
        return energy;
    }
    void voice(uint8_t ch, uint16_t start, uint16_t loop, uint16_t step, uint8_t pan = 255) {
        write(7, 0xc0 | ch); write(0, 100 + ch * 17); write(1, pan);
        write(2, step & 255); write(3, step >> 8); write(4, loop & 255); write(5, loop >> 8); write(6, start >> 8);
    }
};
static void primary_extra_common_bus() {
    assert(!native_rf5c164_create(0));
    assert(!native_extra_rf5c164_create(7999) && !native_extra_rf5c164_create(384001));
    // The old primary ABI accepts any nonzero output rate and has a void,
    // unbounded clock setter. Its load pointer must be valid for nonempty data;
    // only the extra ABI promises explicit null/rate/clock rejection.
    for (uint32_t rate : {1u, 384001u}) {
        void *p = native_rf5c164_create(rate); assert(p); native_rf5c164_set_clock(p, 0);
        float l, r; native_rf5c164_sample(p, &l, &r); assert(l == 0 && r == 0); native_rf5c164_destroy(p);
    }
    for (uint32_t rate : {44100u, 48000u, 96000u}) {
        Pair p(rate);
        std::array<uint8_t, 65536> ram{}, expected{}, copy{};
        for (uint32_t i = 0; i < ram.size(); ++i) ram[i] = pattern(i, 71);
        expected = ram;
        audit = true;
        p.load(ram.data(), 0, ram.size()); ram.fill(0); // Both profiles copy caller bytes.
        assert(native_extra_rf5c164_read_memory_range(p.extra, copy.data(), 0, copy.size()) && copy == expected);
        assert(native_rf5c164_load(p.primary, expected.data(), 65536, 0));
        assert(native_extra_rf5c164_load(p.extra, nullptr, 65536, 0));
        assert(!native_rf5c164_load(p.primary, expected.data(), 65535, 2));
        assert(!native_rf5c164_load(p.primary, expected.data(), 65537, 0));
        assert(!native_rf5c164_load(p.primary, expected.data(), 0xffffffffu, 2));
        assert(!native_extra_rf5c164_load(p.extra, expected.data(), 65535, 2));
        assert(!native_extra_rf5c164_load(p.extra, expected.data(), 65537, 0));
        assert(!native_extra_rf5c164_load(p.extra, nullptr, 0, 1));
        assert(native_extra_rf5c164_read_memory_range(p.extra, nullptr, 65536, 0));
        assert(!native_extra_rf5c164_read_memory_range(p.extra, nullptr, 0, 1));
        copy.fill(0xa5); assert(!native_extra_rf5c164_read_memory_range(p.extra, copy.data(), 65535, 2));
        for (auto value : copy) assert(value == 0xa5);
        for (uint8_t ch = 0; ch < 8; ++ch) p.voice(ch, ch * 256, ch * 256 + 37, 1733 + ch * 731, ch % 3 == 0 ? 15 : ch % 3 == 1 ? 240 : 255);
        p.write(8, 0); assert(p.compare(513) > 1);
        p.write(7, 0x8a); p.memory(0x1234, 0xf7); assert(native_extra_rf5c164_read_memory(p.extra, 0xb234) == 0xf7);
        const uint8_t patch[] = {0x82, 0x17, 0xc0, 0xff}; p.load(patch, 4094, sizeof patch);
        NativeExtraRf5c164State state{}; native_extra_rf5c164_get_state(p.extra, &state);
        assert(state.bank == 0xa000 && state.selected == 7 && state.control == 0x8a);
        assert(native_extra_rf5c164_read_memory(p.extra, 4094) == patch[0] && native_extra_rf5c164_read_memory(p.extra, 4097) == patch[3]);
        for (uint32_t hz : {100000u, 100001u, 6250000u, 12500000u, 25000000u, 100000000u}) {
            p.clock(hz);
            assert(!native_extra_rf5c164_set_clock(p.extra, 99999)); assert(!native_extra_rf5c164_set_clock(p.extra, 100000001));
            assert(p.compare(389) > 0);
            p.write(8, 0x55); p.compare(131); p.write(8, 0xaa); p.compare(131); p.write(8, 0); p.compare(131);
        }
        p.clock(100000); p.reset(); assert(p.compare(131) == 0);
        assert(native_extra_rf5c164_read_memory(p.extra, 0xb234) == 0xf7);
        assert(native_extra_rf5c164_read_memory(p.extra, 4097) == patch[3]);
        p.voice(7, 0xff00, 0xff00, 2048); p.write(8, 0x7f); assert(p.compare(701) > 0);
        p.clock(12500000); p.reset();
        const uint8_t marker = 255; p.load(&marker, 0x100, 1); p.load(&marker, 0x200, 1);
        p.voice(0, 0x100, 0x200, 2048); p.write(8, 0xfe); assert(p.compare(256) == 0);
        const uint8_t sample = 0xc0; p.load(&sample, 0x200, 1); assert(p.compare(256) > 1);
        native_rf5c164_clear_memory(p.primary); native_extra_rf5c164_clear_memory(p.extra); p.compare(256);
        assert(native_extra_rf5c164_read_memory_range(p.extra, copy.data(), 0, copy.size()));
        for (auto value : copy) assert(value == 0);
        audit = false; assert(!allocations && !frees);
    }
}
static void public_mask_hold_and_immediate_cancel() {
    Pair p(48000);
    const uint8_t sample = 0xc0;
    audit = true;
    p.load(&sample, 0, 1); p.voice(0, 0, 0, 0); p.write(8, 0xfe); assert(p.compare(4) > 0);
    p.clock(100000); assert(p.compare(150) > 0);
    float pl, pr, el, er; native_rf5c164_sample(p.primary, &pl, &pr); next(p.extra, el, er); assert(pl == el && pr == er && pl > 0);
    p.write(8, 255); native_rf5c164_sample(p.primary, &pl, &pr); next(p.extra, el, er);
    assert(pl == el && pr == er && pl > 0); // Ordinary register writes retain DAC history until a tick.
    native_extra_rf5c164_key_off(p.extra, 0); next(p.extra, el, er); assert(el == 0 && er == 0);
    native_rf5c164_sample(p.primary, &pl, &pr); assert(pl > 0 && pr > 0);
    native_extra_rf5c164_stop(p.extra); next(p.extra, el, er); assert(el == 0 && er == 0);
    audit = false; assert(!allocations && !frees);
}
static int self_test(){
    static_assert(sizeof(NativeExtraRf5c164State)==100,"Rust ABI");assert(!native_extra_rf5c164_create(0));
    for(uint32_t hz:{100000u,12500000u,100000000u})for(uint32_t rate:{44100u,48000u,96000u}){
        void*a=native_extra_rf5c164_create(rate),*b=native_extra_rf5c164_create(rate);assert(a&&b);std::array<uint8_t,65536> ram{};for(uint32_t i=0;i<ram.size();++i)ram[i]=pattern(i,71);
        audit=true;for(void*p:{a,b}){assert(native_extra_rf5c164_load(p,ram.data(),0,65536));assert(native_extra_rf5c164_load(p,nullptr,65536,0));assert(!native_extra_rf5c164_load(p,ram.data(),65536,1));assert(!native_extra_rf5c164_load(p,nullptr,0,1));for(uint8_t ch=1;ch<8;++ch)voice(p,ch);}voice(a,0);
        float al,ar,bl,br;for(uint32_t i=0;i<1703;++i){next(a,al,ar);next(b,bl,br);}for(void*p:{a,b})assert(native_extra_rf5c164_set_clock(p,hz));assert(!native_extra_rf5c164_set_clock(a,99999));
        for(uint32_t i=0;i<37;++i){next(a,al,ar);next(b,bl,br);}native_extra_rf5c164_write(a,7,0x85);NativeExtraRf5c164State before{},after{};native_extra_rf5c164_get_state(a,&before);native_extra_rf5c164_key_off(a,0);native_extra_rf5c164_get_state(a,&after);assert(after.selected==before.selected&&after.bank==before.bank&&after.control==before.control&&after.mask==(before.mask|1));
        double energy=0;std::array<uint8_t,65536> copy{};
        for(uint32_t i=0;i<1301;++i){native_extra_rf5c164_get_state(a,&after);if(!(i%71))assert(native_extra_rf5c164_read_memory_range(a,copy.data(),0,65536));next(a,al,ar);next(b,bl,br);assert(al==bl&&ar==br);energy+=std::abs(ar);}assert(energy>1);
        assert(copy==ram);assert(!native_extra_rf5c164_read_memory_range(a,copy.data(),65536,1));native_extra_rf5c164_reset(a);native_extra_rf5c164_get_state(a,&after);assert(after.clock==hz&&after.mask==255&&!after.control&&!after.selected&&!after.bank&&native_extra_rf5c164_read_memory(a,65535)==ram[65535]);
        for(uint32_t i=0;i<200;++i){next(a,al,ar);assert(al==0&&ar==0);}voice(a,7);next(a,al,ar);native_extra_rf5c164_stop(a);for(uint32_t i=0;i<200;++i){next(a,al,ar);assert(al==0&&ar==0);}
        native_extra_rf5c164_clear_memory(a);assert(native_extra_rf5c164_read_memory(a,65535)==0);audit=false;assert(!allocations&&!frees);native_extra_rf5c164_destroy(a);native_extra_rf5c164_destroy(b);
    }
    primary_extra_common_bus(); public_mask_hold_and_immediate_cancel();
    std::puts("RF5C164: primary/extra common-bus PCM at3rates/6clocks, 9 foreign-voice isolation cases, copied64KiB/banked RAM/loop markers/reset/clear/bounds, public mask hold versus immediate extra cancel/Stop; callback allocations/frees 0; ABI 100 bytes");return 0;
}
struct Event{uint32_t frame;std::string op;std::vector<uint32_t> args;};
constexpr uint16_t probes[16]={0,1,255,256,4095,4096,8191,8192,12287,16384,32767,32768,49152,65279,65534,65535};
int main(int argc,char**argv){if(argc==2&&std::string(argv[1])=="--self-test")return self_test();if(argc!=3)return 2;uint32_t rate=std::strtoul(argv[1],nullptr,10),frames=std::strtoul(argv[2],nullptr,10);void*p=native_extra_rf5c164_create(rate);if(!p||frames>1048576)return 2;
    std::vector<Event> events;for(std::string line;std::getline(std::cin,line);){std::istringstream in(line);Event e;if(!(in>>e.frame>>e.op))continue;for(uint32_t arg;in>>arg;)e.args.push_back(arg);events.push_back(e);}std::vector<float> output;output.reserve(size_t(frames)*95);size_t index=0;
    std::array<uint8_t,65536> memory{};audit=true;
    for(uint32_t frame=0;frame<frames;++frame){while(index<events.size()&&events[index].frame==frame){const auto&e=events[index++];const auto&a=e.args;
        if(e.op=="write")native_extra_rf5c164_write(p,a[0],a[1]);else if(e.op=="clock")assert(native_extra_rf5c164_set_clock(p,a[0]));else if(e.op=="reset")native_extra_rf5c164_reset(p);else if(e.op=="clear")native_extra_rf5c164_clear_memory(p);else if(e.op=="memory")native_extra_rf5c164_write_memory(p,a[0],a[1]);else if(e.op=="load"){for(uint32_t i=0;i<a[1];++i)memory[i]=pattern(i,a[2]);assert(native_extra_rf5c164_load(p,memory.data(),a[0],a[1]));}else if(e.op=="marker"){const uint8_t marker=255;assert(native_extra_rf5c164_load(p,&marker,a[0],1));}else return 3;
    }float l,r;next(p,l,r);output.push_back(l);output.push_back(r);NativeExtraRf5c164State s{};native_extra_rf5c164_get_state(p,&s);for(auto&ch:s.registers)for(uint8_t v:ch)output.push_back(v);for(uint32_t value:{uint32_t(s.control),uint32_t(s.selected),uint32_t(s.mask),s.clock,uint32_t(s.bank)})output.push_back(float(value));for(uint8_t reg=0;reg<16;++reg)output.push_back(native_extra_rf5c164_read(p,reg));for(uint16_t address:probes)output.push_back(native_extra_rf5c164_read_memory(p,address));}
    audit=false;assert(!allocations&&!frees);native_extra_rf5c164_destroy(p);assert(output.size()==size_t(frames)*95);return std::fwrite(output.data(),sizeof(float),output.size(),stdout)==output.size()?0:4;
}
