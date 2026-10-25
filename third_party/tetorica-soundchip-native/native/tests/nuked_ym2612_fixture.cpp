// Imported Nuked ABI fixture; public header precedes compatibility aliases.
#include <tetorica/nuked_ym2612.hpp>
#define native_ym2612_create native_nuked_ym2612_create
#define native_ym2612_destroy native_nuked_ym2612_destroy
#define native_ym2612_reset native_nuked_ym2612_reset
#define native_ym2612_stop native_nuked_ym2612_stop
#define native_ym2612_write native_nuked_ym2612_write
#define native_ym2612_key_off native_nuked_ym2612_key_off
#define native_ym2612_key_off_fm native_nuked_ym2612_key_off_fm
#define native_ym2612_cancel_csm native_nuked_ym2612_cancel_csm
#define native_ym2612_audition_fm_key_on native_nuked_ym2612_audition_fm_key_on
#define native_ym2612_sample native_nuked_ym2612_sample
#define native_ym2612_set_clock native_nuked_ym2612_set_clock
#define native_ym2612_set_mute_mask native_nuked_ym2612_set_mute_mask
#define native_ym2612_read native_nuked_ym2612_read
#define native_ym2612_read_status native_nuked_ym2612_read_status
#define native_ym2612_get_irq native_nuked_ym2612_get_irq
#define native_ym2612_get_state native_nuked_ym2612_get_state
// Offline standalone FM/DAC/state/allocation fixture; no playback device.
#include <algorithm>
#include <cassert>
#include <cstddef>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <new>
#include <sstream>
#include <string>
#include <vector>

static bool audit = false;
static uint64_t allocations = 0, frees = 0;
void *operator new(std::size_t n) { if (audit) ++allocations; if (void *p = std::malloc(n)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void *p) noexcept { if (audit && p) ++frees; std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p, std::size_t) noexcept { ::operator delete(p); }
extern "C" void *tetorica_nuked_fixture_malloc(std::size_t n) { if (audit) ++allocations; return std::malloc(n); }
extern "C" void tetorica_nuked_fixture_free(void *p) { if (audit && p) ++frees; std::free(p); }
static uint8_t code(uint8_t ch) { return ch < 3 ? ch : ch + 1; }
static void write(void *h, uint8_t reg, uint8_t value, uint8_t port = 0) { native_ym2612_write(h, port, reg, value); }
static void fm(void *h, uint8_t ch = 0) {
    const uint8_t port = ch / 3, offset = ch % 3;
    for (uint8_t op = 0; op < 4; ++op) {
        write(h, 0x30 + offset + op * 4, 1 + op, port);
        write(h, 0x40 + offset + op * 4, 12 + op * 5, port);
        write(h, 0x50 + offset + op * 4, 31, port);
        write(h, 0x60 + offset + op * 4, 4, port);
        write(h, 0x80 + offset + op * 4, 0x2f, port);
    }
    write(h, 0xb0 + offset, 7, port); write(h, 0xb4 + offset, 0xc0, port);
    write(h, 0xa4 + offset, 0x22, port); write(h, 0xa0 + offset, 0x69 + ch, port);
    write(h, 0x28, 0xf0 | code(ch));
}
static double render(void *h, uint32_t frames, bool silent = false) {
    double energy = 0;
    for (uint32_t i = 0; i < frames; ++i) {
        float l, r; native_ym2612_sample(h, &l, &r); assert(std::isfinite(l) && std::isfinite(r));
        if (silent) assert(l == 0 && r == 0);
        energy += std::abs(l) + std::abs(r);
    }
    return energy;
}
static void independent_instances() {
    void *a = native_ym2612_create(48000), *b = native_ym2612_create(48000), *ref = native_ym2612_create(48000); assert(a && b && ref);
    audit = true;
    fm(a); fm(b, 4); fm(ref, 4);
    for (void *h : {b, ref}) { write(h, 0x24, 255); write(h, 0x25, 3); write(h, 0x27, 5); assert(native_ym2612_set_clock(h, 8000000)); }
    for (int frame = 0; frame < 4096; ++frame) {
        if (frame % 31 == 0) { write(a, 0x2a, uint8_t(frame)); write(a, 0x2b, frame & 128); native_ym2612_set_mute_mask(a, frame & 63); }
        if (frame == 701) native_ym2612_reset(a);
        if (frame == 1703) native_ym2612_stop(a);
        if (frame == 2801) native_ym2612_audition_fm_key_on(a, 0, 5);
        float al, ar, bl, br, rl, rr; native_ym2612_sample(a, &al, &ar); native_ym2612_sample(b, &bl, &br); native_ym2612_sample(ref, &rl, &rr);
        assert(std::isfinite(al) && std::isfinite(ar)); assert(bl == rl && br == rr);
        assert(native_ym2612_read_status(b) == native_ym2612_read_status(ref)); assert(native_ym2612_get_irq(b) == native_ym2612_get_irq(ref));
    }
    NativeYm2612State s{}; native_ym2612_get_state(b, &s); assert(s.clock == 8000000 && s.keys[4] == 15 && s.registers[0x1b1] == 7 && s.irq);
    audit = false; assert(allocations == 0 && frees == 0); native_ym2612_destroy(a);
    audit = true;
    for (int i = 0; i < 1024; ++i) { float l, r, a1, b1; native_ym2612_sample(b, &l, &r); native_ym2612_sample(ref, &a1, &b1); assert(l == a1 && r == b1); }
    audit = false; assert(allocations == 0 && frees == 0); native_ym2612_destroy(b); native_ym2612_destroy(ref);
}
static void csm_source_cancellation() {
    void *h = native_ym2612_create(48000), *ref = native_ym2612_create(48000), *idle = native_ym2612_create(48000); assert(h && ref && idle);
    audit = true;
    for (void *chip : {h, ref}) {
        fm(chip, 2); write(chip, 0x24, 255); write(chip, 0x25, 3); write(chip, 0x26, 253); write(chip, 0x27, 0x8f);
    }
    render(h, 1024); render(ref, 1024);
    native_ym2612_cancel_csm(h); write(ref, 0x27, 0x0e);
    NativeYm2612State s{}; native_ym2612_get_state(h, &s);
    assert(s.registers[0x27] == 0x0e && s.keys[2] == 15 && s.registers[0x42] == 12);
    double energy = 0;
    for (int i = 0; i < 2048; ++i) {
        float l, r, a, b; native_ym2612_sample(h, &l, &r); native_ym2612_sample(ref, &a, &b);
        assert(l == a && r == b); energy += std::abs(l) + std::abs(r);
        assert(native_ym2612_read_status(h) == native_ym2612_read_status(ref)); assert(native_ym2612_get_irq(h) == native_ym2612_get_irq(ref));
    }
    assert(energy > 1);
    // The inverse cancellation releases only the normal key source, while an
    // independent CSM lease keeps its timer and authored channel levels.
    for (void *chip : {h, ref}) write(chip, 0x27, 0x8f);
    render(h, 1024); render(ref, 1024); native_ym2612_key_off_fm(h, 2); write(ref, 0x28, 2);
    native_ym2612_get_state(h, &s); assert(!s.keys[2] && s.registers[0x27] == 0x8f && s.registers[0x42] == 12);
    for (int i = 0; i < 2048; ++i) {
        float l, r, a, b; native_ym2612_sample(h, &l, &r); native_ym2612_sample(ref, &a, &b); assert(l == a && r == b);
        assert(native_ym2612_read_status(h) == native_ym2612_read_status(ref));
    }
    // With no normal key, the same operation must remove the CSM-only sound.
    write(h, 0x28, 2); write(h, 0x27, 0x85); render(h, 1024); native_ym2612_cancel_csm(h);
    native_ym2612_get_state(h, &s); assert(!s.keys[2] && !(s.registers[0x27] & 0x81) && s.registers[0x42] == 12);
    for (int i = 0; i < 1024; ++i) {
        float l, r, a, b; native_ym2612_sample(h, &l, &r); native_ym2612_sample(idle, &a, &b); assert(l == a && r == b);
    }
    native_ym2612_audition_fm_key_on(h, 2, 5); native_ym2612_cancel_csm(h); render(h, 512);
    native_ym2612_get_state(h, &s); assert(s.keys[2] == 5);
    audit = false; assert(allocations == 0 && frees == 0); native_ym2612_destroy(h); native_ym2612_destroy(ref); native_ym2612_destroy(idle);
}
static void raw_abi() {
    void *h = tetorica_nuked_create(), *ref = tetorica_nuked_create(); assert(h && ref);
    float l[257], r[257], a[257], b[257], env[4][257];
    audit = true;
    assert(tetorica_nuked_sample_rate(h, 7670454) == 53267);
    assert(tetorica_nuked_sample_rate(h, 8000000) == 55555);
    for (void *core : {h, ref}) {
        for (const auto pair : {std::pair<uint8_t,uint8_t>{0xb6,0xc0}, {0x2a,220}, {0x2b,128}}) {
            tetorica_nuked_write(core, 0, pair.first); tetorica_nuked_write(core, 1, pair.second);
        }
    }
    tetorica_nuked_generate(h, l, r, 257);
    // Zero frames must leave output and chip state untouched.
    a[0] = 123; b[0] = 456;
    tetorica_nuked_generate(ref, a, b, 0); assert(a[0] == 123 && b[0] == 456);
    for (unsigned i = 0; i < 257; ++i) {
        tetorica_nuked_generate(ref, a+i, b+i, 1);
        assert(l[i] == a[i] && r[i] == b[i] && std::isfinite(l[i]));
    }
    for (auto &values : env) std::fill(std::begin(values), std::end(values), 123);
    tetorica_nuked_generate_with_internal_envelope(h, l, r, env[0], env[1], env[2], env[3], 257, 5);
    tetorica_nuked_generate(ref, a, b, 257);
    double energy = 0;
    for (unsigned i = 0; i < 257; ++i) {
        assert(l[i] == a[i] && r[i] == b[i]); energy += std::abs(l[i]) + std::abs(r[i]);
        for (auto &values : env) assert(values[i] == 0);
    }
    assert(energy > 1);
    for (unsigned i = 0; i < 4; ++i) assert(tetorica_nuked_read(h, i) == tetorica_nuked_read(ref, i));
    assert(tetorica_nuked_read_status(h) == tetorica_nuked_read_status(ref));
    assert(tetorica_nuked_get_irq(h) == tetorica_nuked_get_irq(ref));
    // Observation must not advance the raw chip's phase/timers either.
    for (unsigned i = 0; i < 100; ++i) {
        for (unsigned port = 0; port < 4; ++port) tetorica_nuked_read(h, port);
        tetorica_nuked_read_status(h); tetorica_nuked_get_irq(h);
    }
    tetorica_nuked_generate(h, l, r, 257); tetorica_nuked_generate(ref, a, b, 257);
    for (unsigned i = 0; i < 257; ++i) assert(l[i] == a[i] && r[i] == b[i]);
    tetorica_nuked_reset(h); tetorica_nuked_reset(ref);
    tetorica_nuked_generate(h, l, r, 257); tetorica_nuked_generate(ref, a, b, 257);
    for (unsigned i = 0; i < 257; ++i) assert(l[i] == a[i] && r[i] == b[i]);
    audit = false; assert(allocations == 0 && frees == 0);
    tetorica_nuked_destroy(h); tetorica_nuked_destroy(ref);
}
static int self_test() {
    raw_abi();
    static_assert(sizeof(NativeYm2612State) == 528, "Rust FFI state layout");
    static_assert(offsetof(NativeYm2612State, clock) == 512 && offsetof(NativeYm2612State, channel_mute_mask) == 516 &&
                  offsetof(NativeYm2612State, keys) == 520 && offsetof(NativeYm2612State, status) == 526 &&
                  offsetof(NativeYm2612State, irq) == 527, "Shared state offsets");
    for (uint32_t rate : {8000u, 44100u, 48000u, 96000u, 384000u}) {
        void *edge = native_ym2612_create(rate); assert(edge); native_ym2612_destroy(edge);
    }
    independent_instances();
    csm_source_cancellation();
    assert(!native_ym2612_create(7999) && !native_ym2612_create(384001));
    void *h = native_ym2612_create(48000), *ref = native_ym2612_create(48000); assert(h && ref);
    NativeYm2612State s{}; audit = true;
    native_ym2612_get_state(h, &s); assert(s.clock == 7670454 && !s.channel_mute_mask);
    for (uint8_t ch = 0; ch < 6; ++ch) { fm(h, ch); fm(ref, ch); }
    assert(render(h, 1024) > 1); render(ref, 1024);
    // Reads/snapshots cannot clock oscillators, timers or envelopes.
    for (int i = 0; i < 100; ++i) { native_ym2612_get_state(h, &s); native_ym2612_read(h, 0); }
    for (int i = 0; i < 1024; ++i) { float l, r, a, b; native_ym2612_sample(h, &l, &r); native_ym2612_sample(ref, &a, &b); assert(l == a && r == b); }
    write(h, 0xa4, 0x29); write(h, 0xa1, 0x91, 1); write(h, 0xad, 0x19, 1); write(h, 0xa8, 0x69);
    native_ym2612_get_state(h, &s); assert(s.registers[0x1a5] == 0x29 && s.registers[0x1a1] == 0x91 && s.registers[0xac] == 0x19 && s.registers[0xa8] == 0x69);
    native_ym2612_set_mute_mask(h, 9); assert(native_ym2612_set_clock(h, 100000)); assert(!native_ym2612_set_clock(h, 99999)); assert(!native_ym2612_set_clock(h, 100000001));
    native_ym2612_stop(h); native_ym2612_get_state(h, &s); assert(s.clock == 100000 && s.channel_mute_mask == 9 && s.registers[0xb0] == 7 && s.registers[0x40] == 12);
    for (auto key : s.keys) assert(!key); assert(render(h, 1024, true) == 0);
    native_ym2612_audition_fm_key_on(h, 4, 5); assert(render(h, 2048) > .1); native_ym2612_get_state(h, &s); assert(s.keys[4] == 5);
    native_ym2612_key_off(h, 4); native_ym2612_get_state(h, &s); assert(!s.keys[4] && s.registers[0x141] == 12);
    native_ym2612_stop(h); write(h, 0xb6, 0xc0, 1); write(h, 0x2a, 0xff); write(h, 0x2b, 0x80); assert(render(h, 1024) > .1);
    native_ym2612_stop(h); assert(render(h, 1024, true) == 0);
    native_ym2612_reset(h); native_ym2612_get_state(h, &s); assert(s.clock == 100000 && s.channel_mute_mask == 9); for (auto key : s.keys) assert(!key);
    // Deferred gates are cancelled by Stop/reset and never allocate on callback.
    fm(h); native_ym2612_audition_fm_key_on(h, 0, 15); native_ym2612_stop(h); render(h, 1024, true);
    native_ym2612_audition_fm_key_on(h, 0, 15); native_ym2612_reset(h); render(h, 1024); native_ym2612_get_state(h, &s); assert(!s.keys[0]);
    audit = false; assert(allocations == 0 && frees == 0); native_ym2612_destroy(h); native_ym2612_destroy(ref);
    std::puts("Standalone Nuked YM2612 raw/native ABIs; independent instances, six FM channels, raw DAC, latch-safe observational state, timers/status/IRQ, retained Stop, deferred gates/reset/mute, zero callback allocations/frees passed"); return 0;
}
struct Event { uint32_t frame = 0, a = 0, b = 0, c = 0; std::string op; };
int main(int argc, char **argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") return self_test();
        if (argc != 3) return 2;
        const uint32_t rate = std::stoul(argv[1]), frames = std::stoul(argv[2]); if (frames > 10000000) return 2;
        std::vector<Event> events; std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event e; if (!(in >> e.frame >> e.op)) continue;
            if (e.op == "write") in >> e.a >> e.b >> e.c;
            else if (e.op == "clock" || e.op == "mute" || e.op == "off" || e.op == "off-fm") in >> e.a;
            else if (e.op == "audition") in >> e.a >> e.b;
            else if (e.op != "reset" && e.op != "stop" && e.op != "cancel-csm") return 2;
            events.push_back(std::move(e));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        void *h = native_ym2612_create(rate); if (!h) return 3;
        std::vector<float> pcm(frames * 8); size_t next = 0; audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &e = events[next++];
                if (e.op == "write") native_ym2612_write(h, e.a, e.b, e.c);
                else if (e.op == "clock") assert(native_ym2612_set_clock(h, e.a));
                else if (e.op == "mute") native_ym2612_set_mute_mask(h, e.a);
                else if (e.op == "off") native_ym2612_key_off(h, e.a);
                else if (e.op == "off-fm") native_ym2612_key_off_fm(h, e.a);
                else if (e.op == "cancel-csm") native_ym2612_cancel_csm(h);
                else if (e.op == "audition") native_ym2612_audition_fm_key_on(h, e.a, e.b);
                else if (e.op == "reset") native_ym2612_reset(h);
                else if (e.op == "stop") native_ym2612_stop(h);
            }
            native_ym2612_sample(h, &pcm[frame * 8], &pcm[frame * 8 + 1]);
            pcm[frame * 8 + 2] = native_ym2612_read_status(h); pcm[frame * 8 + 3] = native_ym2612_get_irq(h);
            for (uint8_t port = 0; port < 4; ++port) pcm[frame * 8 + 4 + port] = native_ym2612_read(h, port);
        }
        audit = false; assert(allocations == 0 && frees == 0); native_ym2612_destroy(h);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
