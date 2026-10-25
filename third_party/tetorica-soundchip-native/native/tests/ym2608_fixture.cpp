// Offline PCM/state/allocation fixture; never opens an audio device.
#include <tetorica/ym2608.hpp>
#include <algorithm>
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

static bool audit = false;
static uint64_t allocations = 0, frees = 0;
void *operator new(std::size_t n) { if (audit) ++allocations; if (void *p = std::malloc(n)) return p; throw std::bad_alloc(); }
void *operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void *p) noexcept { if (audit && p) ++frees; std::free(p); }
void operator delete[](void *p) noexcept { ::operator delete(p); }
void operator delete(void *p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void *p, std::size_t) noexcept { ::operator delete(p); }

static void write(void *chip, uint8_t port, uint8_t reg, uint8_t value) { native_ym2608_write(chip, port, reg, value); }
static void *create(bool extra) { return extra ? native_ym2608_create_extra(48000) : native_ym2608_create(48000); }
static void fm_note(void *chip, uint8_t channel, uint8_t pan) {
    const uint8_t port = channel / 3, local = channel % 3;
    write(chip, 0, 0x29, 0x9f);
    for (uint8_t op = 0; op < 4; ++op) {
        const uint8_t slot = local + op * 4;
        write(chip, port, 0x30 + slot, 1);
        write(chip, port, 0x40 + slot, op == 3 ? 20 : 127);
        write(chip, port, 0x50 + slot, 31);
        write(chip, port, 0x60 + slot, 0);
        write(chip, port, 0x80 + slot, 15);
    }
    write(chip, port, 0xb0 + local, 7); write(chip, port, 0xb4 + local, pan);
    write(chip, port, 0xa4 + local, 0x22); write(chip, port, 0xa0 + local, 0x69);
    write(chip, 0, 0x28, 0xf0 | (channel < 3 ? channel : channel + 1));
}
static void all_fm_channels(bool extra) {
    for (uint8_t channel = 0; channel < 6; ++channel) for (uint8_t pan : {0x80, 0x40, 0xc0}) {
        void *chip = create(extra), *reference = create(extra); assert(chip && reference);
        audit = true; fm_note(chip, channel, pan); fm_note(reference, channel, pan);
        double energy_l = 0, energy_r = 0;
        for (int i = 0; i < 1024; ++i) {
            NativeYm2608State state{}; NativeYm2608ExtraState metadata{};
            native_ym2608_get_state(chip, &state); native_ym2608_get_extra_state(chip, &metadata);
            assert((!extra || metadata.keys[channel] == 15) && state.registers[0x29] == 0x9f);
            float l, r, rl, rr;
            native_ym2608_sample(chip, &l, &r); native_ym2608_sample(reference, &rl, &rr);
            assert(std::isfinite(l) && std::isfinite(r) && l == rl && r == rr);
            energy_l += std::abs(l); energy_r += std::abs(r);
        }
        assert((pan & 0x80) ? energy_l > 1 : energy_l == 0);
        assert((pan & 0x40) ? energy_r > 1 : energy_r == 0);
        native_ym2608_stop(chip);
        float l, r, rl, rr; native_ym2608_sample(chip, &l, &r); assert(l == 0 && r == 0);
        double reference_energy = 0;
        for (int i = 0; i < 128; ++i) {
            native_ym2608_sample(reference, &rl, &rr); reference_energy += std::abs(rl) + std::abs(rr);
        }
        assert(reference_energy > 0.1);
        audit = false; assert(allocations == 0 && frees == 0);
        native_ym2608_destroy(chip); native_ym2608_destroy(reference);
    }
}
static void distinct_reset_profiles() {
    void *primary = create(false), *extra = create(true); assert(primary && extra);
    audit = true;
    for (void *chip : {primary, extra}) {
        write(chip, 0, 7, 63); write(chip, 0, 8, 15);
        float l, r;
        for (int i = 0; i < 4; ++i) native_ym2608_sample(chip, &l, &r);
        assert(l > 0 && r > 0); assert(native_ym2608_set_clock(chip, 100000));
        native_ym2608_reset(chip);
    }
    float pl, pr, el, er;
    native_ym2608_sample(primary, &pl, &pr); native_ym2608_sample(extra, &el, &er);
    // At this low clock the first output does not advance a source sample.
    // Primary reset clears its outer hold/remainder, while extra retains it.
    assert(pl == 0 && pr == 0 && el > 0 && er > 0);
    for (int i = 0; i < 128; ++i) {
        native_ym2608_sample(primary, &pl, &pr); native_ym2608_sample(extra, &el, &er);
        assert(std::isfinite(pl) && std::isfinite(pr) && std::isfinite(el) && std::isfinite(er));
    }
    native_ym2608_stop(primary); native_ym2608_stop(extra);
    for (int i = 0; i < 64; ++i) {
        native_ym2608_sample(primary, &pl, &pr); native_ym2608_sample(extra, &el, &er);
        assert(pl == 0 && pr == 0 && el == 0 && er == 0);
    }
    audit = false; assert(allocations == 0 && frees == 0);
    native_ym2608_destroy(primary); native_ym2608_destroy(extra);
}
static void memory_lifetime_and_adpcm_observation(bool extra) {
    void *chip = create(extra); assert(chip);
    uint8_t rom[8192], original[32], copied[32];
    for (uint32_t i = 0; i < sizeof rom; ++i) rom[i] = uint8_t(i * 7 + 3);
    std::memcpy(original, rom, sizeof original);
    audit = true;
    assert(native_ym2608_load_rom(chip, rom, 0, sizeof rom));
    assert(native_ym2608_load_memory(chip, rom, 0, sizeof original));
    std::memset(rom, 0, sizeof rom); // Both transfers own their copied bytes.
    for (int pass = 0; pass < 2; ++pass) {
        assert(native_ym2608_copy_memory(chip, copied, 0, sizeof copied));
        assert(std::memcmp(original, copied, sizeof copied) == 0);
        write(chip, 0, 0x11, 63); write(chip, 0, 0x18, 0xdf); write(chip, 0, 0x10, 1);
        double energy = 0;
        for (int i = 0; i < 1024; ++i) {
            float l, r; native_ym2608_sample(chip, &l, &r);
            assert(std::isfinite(l) && std::isfinite(r)); energy += std::abs(l) + std::abs(r);
        }
        assert(energy > 1); // ROM remains audible after source mutation and Stop/reset.
        native_ym2608_stop(chip); native_ym2608_reset(chip);
    }
    write(chip, 0, 0x29, 0x9f); write(chip, 1, 0x10, 0x1b); // Only ADPCM EOS IRQ unmasked.
    write(chip, 1, 1, 0xc2); write(chip, 1, 2, 0); write(chip, 1, 3, 0);
    write(chip, 1, 4, 0); write(chip, 1, 5, 0);
    write(chip, 1, 9, 0xff); write(chip, 1, 10, 0xff); write(chip, 1, 11, 200); write(chip, 1, 0, 0xa0);
    double energy = 0;
    for (int i = 0; i < 1024; ++i) {
        float l, r; native_ym2608_sample(chip, &l, &r); energy += std::abs(l) + std::abs(r);
        assert(std::isfinite(l) && std::isfinite(r));
    }
    assert(energy > 0.1);
    NativeYm2608State state{}; NativeYm2608ExtraState metadata{};
    for (int i = 0; i < 32; ++i) {
        native_ym2608_get_state(chip, &state); native_ym2608_get_extra_state(chip, &metadata);
        assert((state.status_hi & 4) && (metadata.status_hi & 4));
        assert(!state.irq && !metadata.irq && !native_ym2608_get_irq(chip));
    }
    // Unlike observation, the CPU's extended-status read propagates ADPCM
    // flags into FM status/IRQ. Snapshotting must never perform that read.
    assert(native_ym2608_read_status_hi(chip) & 4); assert(native_ym2608_get_irq(chip));
    write(chip, 1, 0x10, 0x80); assert(!native_ym2608_get_irq(chip));
    native_ym2608_get_state(chip, &state); assert((state.status_hi & 4) && !state.irq);
    native_ym2608_clear_memory(chip);
    assert(native_ym2608_copy_memory(chip, copied, 0, sizeof copied));
    for (auto value : copied) assert(value == 0);
    audit = false; assert(allocations == 0 && frees == 0); native_ym2608_destroy(chip);
}
static void foreign_voice_continuity() {
    void *first = native_ym2608_create_extra(48000), *reference = native_ym2608_create_extra(48000);
    assert(first && reference);
    uint8_t waveform[8192]; for (uint32_t i = 0; i < sizeof waveform; ++i) waveform[i] = uint8_t(i * 7 + 3);
    audit = true;
    for (void *p : {first, reference}) {
        assert(native_ym2608_load_rom(p, waveform, 0, sizeof waveform));
        assert(native_ym2608_load_memory(p, waveform, 0, sizeof waveform));
        for (uint8_t op = 0; op < 4; ++op) {
            const uint8_t n = 1 + op * 4;
            write(p, 0, 0x30 + n, 1 + op); write(p, 0, 0x40 + n, 20 + op);
            write(p, 0, 0x50 + n, 31); write(p, 0, 0x60 + n, 0); write(p, 0, 0x80 + n, 15);
        }
        write(p, 0, 0xb1, 7); write(p, 0, 0xb5, 0xc0); write(p, 0, 0xa5, 0x22); write(p, 0, 0xa1, 0x69); write(p, 0, 0x28, 0xf1);
        write(p, 0, 0, 0x34); write(p, 0, 1, 2); write(p, 0, 7, 0x3e); write(p, 0, 8, 12);
        write(p, 0, 0x11, 63); write(p, 0, 0x18, 0xdf); write(p, 0, 0x10, 1);
        write(p, 1, 1, 0xc2); write(p, 1, 2, 0); write(p, 1, 3, 0); write(p, 1, 4, 0xff); write(p, 1, 5, 0);
        write(p, 1, 9, 0); write(p, 1, 10, 0x40); write(p, 1, 11, 180); write(p, 1, 0, 0xb0);
    }
    for (uint32_t clock : {8000000u, 100000u, 8000000u}) {
        for (uint8_t op = 0; op < 4; ++op) {
            const uint8_t n = op * 4;
            write(first, 0, 0x30 + n, 1 + op); write(first, 0, 0x40 + n, 20 + op);
            write(first, 0, 0x50 + n, 31); write(first, 0, 0x60 + n, 0); write(first, 0, 0x80 + n, 15);
        }
        write(first, 0, 0xb0, 7); write(first, 0, 0xb4, 0xc0); write(first, 0, 0xa4, 0x22); write(first, 0, 0xa0, 0x85); write(first, 0, 0x28, 0xf0);
        assert(native_ym2608_set_clock(first, clock)); assert(native_ym2608_set_clock(reference, clock));
        for (uint32_t frame = 0; frame < 4096; ++frame) {
            // Cancelling sounding CH1 (and later unused FM slots) must leave
            // the independently held FM/SSG/rhythm/ADPCM-B exactly equal to a
            // second core where CH1 was never started, even during upsample holds.
            if (frame == 701) native_ym2608_key_off(first, 0);
            if (frame == 1703) native_ym2608_key_off(first, 5);
            if (frame == 2801) native_ym2608_key_off(first, 2);
            float l, r, expected_l, expected_r;
            native_ym2608_sample(first, &l, &r); native_ym2608_sample(reference, &expected_l, &expected_r);
            if (frame >= 701) assert(l == expected_l && r == expected_r);
        }
    }
    audit = false; assert(allocations == 0 && frees == 0);
    native_ym2608_destroy(first); native_ym2608_destroy(reference);
}
static int self_test(bool extra) {
    assert(!native_ym2608_create(0));
    assert(!native_ym2608_create_extra(0));
    void *chip = extra ? native_ym2608_create_extra(48000) : native_ym2608_create(48000); assert(chip);
    static_assert(sizeof(NativeYm2608State) == 524, "primary ABI");
    static_assert(sizeof(NativeYm2608ExtraState) == 536, "extra ABI");
    uint8_t bytes[32]; for (uint8_t i = 0; i < 32; ++i) bytes[i] = i * 7;
    uint8_t readback[32] = {};
    NativeYm2608State state{};
    audit = true;
    assert(native_ym2608_load_rom(chip, bytes, 0x1fe0, 32));
    assert(!native_ym2608_load_rom(chip, bytes, 0x1ff0, 32));
    assert(native_ym2608_load_memory(chip, bytes, 0x1fffe0, 32));
    assert(!native_ym2608_load_memory(chip, bytes, 0x1ffff0, 32));
    assert(!native_ym2608_load_memory(chip, nullptr, 0, 1));
    assert(native_ym2608_load_rom(chip, nullptr, 0x2000, 0));
    assert(native_ym2608_load_memory(chip, nullptr, 0x200000, 0));
    assert(native_ym2608_copy_memory(chip, nullptr, 0x200000, 0));
    assert(!native_ym2608_load_rom(chip, nullptr, 0, 1));
    assert(!native_ym2608_load_rom(chip, bytes, 0x2001, 0));
    assert(!native_ym2608_load_memory(chip, bytes, 0x200001, 0));
    assert(!native_ym2608_copy_memory(chip, readback, 0x200001, 0));
    assert(!native_ym2608_copy_memory(chip, nullptr, 0, 1));
    assert(!native_ym2608_load_memory(chip, bytes, 0xffffffffu, 32));
    assert(!native_ym2608_load_rom(chip, bytes, 0, 0xffffffffu));
    std::memset(readback, 0xa5, sizeof readback);
    assert(!native_ym2608_copy_memory(chip, readback, 0x1ffff0, 32));
    for (auto value : readback) assert(value == 0xa5); // Rejected copy never partially writes.
    assert(native_ym2608_copy_memory(chip, readback, 0x1fffe0, 32));
    assert(std::memcmp(bytes, readback, 32) == 0); // Rejected uploads leave RAM intact.
    assert(native_ym2608_set_clock(chip, 100000));
    assert(native_ym2608_set_clock(chip, 100000000));
    assert(!native_ym2608_set_clock(chip, 1));
    assert(!native_ym2608_set_clock(chip, 100000001));
    assert(native_ym2608_set_clock(chip, 7987200));
    native_ym2608_set_source_mute_mask(chip, 5);
    write(chip, 0, 0x29, 0x9f); write(chip, 0, 0xb0, 7);
    write(chip, 1, 0x10, 5); write(chip, 1, 0x10, 0x80);
    for (uint8_t slot : {0, 4, 8, 12}) {
        write(chip, 0, 0x30 + slot, 1);
        write(chip, 0, 0x40 + slot, slot == 12 ? 24 : 127);
        write(chip, 0, 0x50 + slot, 31);
        write(chip, 0, 0x80 + slot, 1);
    }
    write(chip, 0, 0xa4, 0x22); write(chip, 0, 0xa0, 0x69); write(chip, 0, 0x28, 0xf0);
    write(chip, 0, 0xa4, 0x22); write(chip, 1, 0xa1, 0x77);
    native_ym2608_get_state(chip, &state);
    assert(state.registers[0x1a5] == 0x22 && state.registers[0x1a1] == 0x77);
    write(chip, 0, 0, 0x34); write(chip, 0, 1, 2); write(chip, 0, 7, 0x3e); write(chip, 0, 8, 12);
    write(chip, 1, 2, 0x12); write(chip, 1, 9, 0x34); write(chip, 0, 0x18, 0xde);
    float left = 0, right = 0; double sounding_energy = 0;
    for (uint32_t i = 0; i < 4000; ++i) { native_ym2608_sample(chip, &left, &right); sounding_energy += std::abs(left) + std::abs(right); }
    assert(sounding_energy > 1);
    native_ym2608_stop(chip);
    native_ym2608_get_state(chip, &state);
    assert(state.clock == 7987200 && state.source_mute_mask == 5);
    assert(state.registers[0xb0] == 7 && state.registers[0x29] == 0x9f);
    assert(state.registers[0x110] == 5); // Flag-clear retained the IRQ mask.
    assert(state.registers[0x1a5] == 0x22 && state.registers[0x1a1] == 0x77);
    assert(state.registers[0] == 0x34 && state.registers[1] == 2 && state.registers[8] == 0);
    assert(state.registers[0x102] == 0x12 && state.registers[0x109] == 0x34 && state.registers[0x18] == 0xde);
    for (uint32_t i = 0; i < 256; ++i) native_ym2608_sample(chip, &left, &right);
    assert(left == 0 && right == 0);
    write(chip, 0, 0x28, 0xf0); sounding_energy = 0;
    for (uint32_t i = 0; i < 256; ++i) { native_ym2608_sample(chip, &left, &right); sounding_energy += std::abs(left) + std::abs(right); }
    assert(sounding_energy > 0.1); // Stop kept the authored FM instrument/pitch.
    native_ym2608_reset(chip);
    native_ym2608_get_state(chip, &state);
    assert(state.clock == 7987200 && state.source_mute_mask == 5 && state.registers[0xb0] == 0);
    assert(native_ym2608_copy_memory(chip, readback, 0x1fffe0, 32));
    assert(std::memcmp(bytes, readback, 32) == 0);
    write(chip, 0, 0, 0x55);
    assert(native_ym2608_read(chip, 1) == 0x55);
    const uint8_t irq = native_ym2608_get_irq(chip);
    for (int i = 0; i < 100; ++i) native_ym2608_get_state(chip, &state);
    assert(native_ym2608_get_irq(chip) == irq);
    NativeYm2608ExtraState prescaler{};
    for (uint8_t select : {0x2e, 0x2f, 0x2d}) {
        write(chip, 0, select, 0); native_ym2608_get_extra_state(chip, &prescaler);
        assert(prescaler.prescaler == (select == 0x2e ? 3 : select == 0x2f ? 2 : 6));
    }
    write(chip, 0, 0x29, 0x9f); write(chip, 1, 0x10, 0x1c);
    write(chip, 0, 0x24, 255); write(chip, 0, 0x25, 3); write(chip, 0, 0x27, 5);
    for (uint32_t i = 0; i < 128; ++i) native_ym2608_sample(chip, &left, &right);
    native_ym2608_get_state(chip, &state);
    assert((state.status & 1) && (state.status_hi & 1) && state.irq);
    assert(native_ym2608_read_status(chip) == state.status);
    assert(native_ym2608_read_status_hi(chip) == state.status_hi);
    write(chip, 0, 0x27, 0x10);
    native_ym2608_get_state(chip, &state);
    assert(!(state.status & 1) && !state.irq);
    // Hardware-style CPU memory upload/download uses the very same reserved
    // RAM as load_memory; inspection must not consume these two dummy reads.
    write(chip, 1, 1, 2); write(chip, 1, 2, 0x10); write(chip, 1, 3, 0);
    write(chip, 1, 4, 0x11); write(chip, 1, 5, 0); write(chip, 1, 0, 0x60);
    for (auto value : bytes) write(chip, 1, 8, value);
    assert(native_ym2608_copy_memory(chip, readback, 0x200, 32));
    assert(std::memcmp(bytes, readback, 32) == 0);
    write(chip, 1, 0, 0x20); write(chip, 1, 8, 0);
    native_ym2608_get_state(chip, &state);
    assert(native_ym2608_read(chip, 3) == 0);
    native_ym2608_get_state(chip, &state);
    assert(native_ym2608_read(chip, 3) == 0);
    for (auto value : bytes) assert(native_ym2608_read(chip, 3) == value);
    for (uint8_t voice = 0; voice < 16; ++voice) native_ym2608_key_off(chip, voice);
    native_ym2608_clear_memory(chip);
    assert(native_ym2608_copy_memory(chip, readback, 0x1fffe0, 32));
    for (auto value : readback) assert(value == 0);
    if (extra) {
        NativeYm2608ExtraState metadata{};
        write(chip, 0, 0x28, 0xa2); write(chip, 0, 8, 16); write(chip, 0, 0x27, 0x8f);
        native_ym2608_cancel_csm(chip); native_ym2608_get_extra_state(chip, &metadata);
        assert(metadata.keys[2] == 10 && !(metadata.registers[0x27] & 0x81) && (metadata.registers[0x27] & 2));
        write(chip, 0, 0x27, 0x8f); native_ym2608_key_off_fm(chip, 2); native_ym2608_get_extra_state(chip, &metadata);
        assert(!metadata.keys[2] && (metadata.registers[0x27] & 0x81) == 0x81);
        native_ym2608_cancel_csm(chip); native_ym2608_get_extra_state(chip, &metadata);
        assert(!(metadata.registers[0x27] & 0x81) && metadata.ssg_levels[0] == 16);
        native_ym2608_key_off(chip, 6); native_ym2608_get_extra_state(chip, &metadata);
        assert(metadata.ssg_levels[0] == 16 && metadata.registers[8] == 0);
        native_ym2608_set_retained_ssg_level(chip, 0, 0); native_ym2608_get_extra_state(chip, &metadata);
        assert(metadata.ssg_levels[0] == 0);
        native_ym2608_audition_fm_key_on(chip, 0, 5); native_ym2608_stop(chip);
        for (int i = 0; i < 200; ++i) { native_ym2608_sample(chip, &left, &right); assert(left == 0 && right == 0); }
        native_ym2608_get_extra_state(chip, &metadata); assert(!metadata.keys[0]);
        native_ym2608_audition_fm_key_on(chip, 0, 5); native_ym2608_reset(chip);
        for (int i = 0; i < 200; ++i) native_ym2608_sample(chip, &left, &right);
        native_ym2608_get_extra_state(chip, &metadata); assert(!metadata.keys[0]);
    }
    audit = false;
    assert(allocations == 0 && frees == 0);
    // Independently allocated ROM/RAM and clock/state must never alias.
    if (extra) {
        void *other = native_ym2608_create_extra(48000); assert(other);
        assert(native_ym2608_load_memory(chip, bytes, 0x123, 32));
        assert(native_ym2608_copy_memory(other, readback, 0x123, 32));
        for (auto value : readback) assert(value == 0);
        native_ym2608_reset(other);
        assert(native_ym2608_copy_memory(chip, readback, 0x123, 32)); assert(std::memcmp(bytes, readback, 32) == 0);
        uint8_t alternate_rom[8192]; std::memset(alternate_rom, 0xff, sizeof alternate_rom);
        audit = true;
        native_ym2608_reset(chip); native_ym2608_reset(other);
        native_ym2608_set_clock(chip, 8000000); native_ym2608_set_source_mute_mask(chip, 0);
        assert(native_ym2608_load_rom(other, alternate_rom, 0, sizeof alternate_rom));
        for (void *p : {chip, other}) { write(p, 0, 0x11, 63); write(p, 0, 0x18, 0xdf); write(p, 0, 0x10, 1); }
        double difference = 0; float other_left = 0, other_right = 0;
        for (int i = 0; i < 512; ++i) {
            native_ym2608_sample(chip, &left, &right); native_ym2608_sample(other, &other_left, &other_right);
            difference += std::abs(left - other_left) + std::abs(right - other_right);
        }
        assert(difference > 1); // Loading a different ROM changed only its owner.
        audit = false; assert(allocations == 0 && frees == 0);
        native_ym2608_destroy(other);
    }
    native_ym2608_destroy(chip);
    all_fm_channels(extra);
    memory_lifetime_and_adpcm_observation(extra);
    if (extra) foreign_voice_continuity();
    std::puts("YM2608 state/Stop/reset/memory/clock self-test passed; callback allocations 0, frees 0");
    return 0;
}
struct Event { uint32_t frame = 0, a = 0, b = 0, c = 0; std::string op; std::vector<uint8_t> bytes; };
int main(int argc, char **argv) {
    try {
        const bool extra = argc > 1 && std::string(argv[1]) == "--extra";
        if (extra) { --argc; ++argv; }
        if (argc == 2 && std::string(argv[1]) == "--self-test") { self_test(false); self_test(true); distinct_reset_profiles(); return 0; }
        if (argc != 3) return 2;
        const uint32_t rate = std::stoul(argv[1]), frames = std::stoul(argv[2]);
        if (frames > 10000000) return 2;
        std::vector<Event> events;
        std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event event;
            if (!(in >> event.frame >> event.op)) continue;
            if (event.op == "write") in >> event.a >> event.b >> event.c;
            else if (event.op == "clock" || event.op == "mute" || event.op == "off" || event.op == "off-fm") in >> event.a;
            else if (event.op == "audition" || event.op == "level") in >> event.a >> event.b;
            else if (event.op == "rom" || event.op == "memory") {
                std::string hex; in >> event.a >> hex; assert(hex.size() % 2 == 0);
                for (size_t i = 0; i < hex.size(); i += 2) event.bytes.push_back(std::stoul(hex.substr(i, 2), nullptr, 16));
            }
            else if (event.op != "clear" && event.op != "reset" && event.op != "stop" && event.op != "cancel-csm") return 2;
            events.push_back(std::move(event));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        void *chip = extra ? native_ym2608_create_extra(rate) : native_ym2608_create(rate); if (!chip) return 3;
        const uint32_t planes = extra ? 9 : 2;
        std::vector<float> pcm(frames * planes);
        size_t next = 0;
        audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &e = events[next++];
                if (e.op == "write") write(chip, e.a, e.b, e.c);
                else if (e.op == "clock") assert(native_ym2608_set_clock(chip, e.a));
                else if (e.op == "mute") native_ym2608_set_source_mute_mask(chip, e.a);
                else if (e.op == "off") native_ym2608_key_off(chip, e.a);
                else if (e.op == "off-fm") native_ym2608_key_off_fm(chip, e.a);
                else if (e.op == "cancel-csm") native_ym2608_cancel_csm(chip);
                else if (e.op == "audition") native_ym2608_audition_fm_key_on(chip, e.a, e.b);
                else if (e.op == "level") native_ym2608_set_retained_ssg_level(chip, e.a, e.b);
                else if (e.op == "rom") assert(native_ym2608_load_rom(chip, e.bytes.data(), e.a, e.bytes.size()));
                else if (e.op == "memory") assert(native_ym2608_load_memory(chip, e.bytes.data(), e.a, e.bytes.size()));
                else if (e.op == "clear") native_ym2608_clear_memory(chip);
                else if (e.op == "reset") native_ym2608_reset(chip);
                else if (e.op == "stop") native_ym2608_stop(chip);
            }
            native_ym2608_sample(chip, &pcm[frame * planes], &pcm[frame * planes + 1]);
            if (extra) {
                pcm[frame * planes + 2] = native_ym2608_read_status(chip);
                pcm[frame * planes + 3] = native_ym2608_read_status_hi(chip);
                pcm[frame * planes + 4] = native_ym2608_get_irq(chip);
                for (uint8_t port = 0; port < 4; ++port) pcm[frame * planes + 5 + port] = native_ym2608_read(chip, port);
            }
        }
        audit = false;
        assert(allocations == 0 && frees == 0);
        native_ym2608_destroy(chip);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; }
}
