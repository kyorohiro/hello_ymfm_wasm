// Offline PCM/state/allocation fixture; never opens an audio device.
#include <tetorica/ym2610.hpp>
#include <tetorica/ym2610b.hpp>
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

static void write(void *chip, uint8_t port, uint8_t reg, uint8_t value) { native_ym2610b_write(chip, port, reg, value); }
static double render(void *chip, uint32_t frames) {
    double energy = 0; float l = 0, r = 0;
    for (uint32_t i = 0; i < frames; ++i) { native_ym2610b_sample(chip, &l, &r); assert(std::isfinite(l) && std::isfinite(r)); energy += std::abs(l) + std::abs(r); }
    return energy;
}
static void fm(void *chip, uint8_t channel) {
    const uint8_t port = channel / 3, ch = channel % 3;
    write(chip, port, 0xb0 + ch, 7);
    for (uint8_t slot : {0, 4, 8, 12}) {
        write(chip, port, 0x30 + slot + ch, 1);
        write(chip, port, 0x40 + slot + ch, slot == 12 ? 24 : 127);
        write(chip, port, 0x50 + slot + ch, 31);
        write(chip, port, 0x80 + slot + ch, 1);
    }
    write(chip, port, 0xa4 + ch, 0x22); write(chip, port, 0xa0 + ch, 0x69);
    write(chip, 0, 0x28, 0xf0 | (channel < 3 ? channel : channel + 1));
}
static void physical_channels_and_reset(bool extra, uint8_t variant) {
    void *chip = extra ? native_ym2610b_create_extra_variant(48000, variant) : native_ym2610b_create(48000, variant);
    assert(chip);
    audit = true;
    for (uint8_t ch = 0; ch < 6; ++ch) for (uint8_t pan : {0x80, 0x40, 0xc0}) {
        native_ym2610b_reset(chip); fm(chip, ch); write(chip, ch / 3, 0xb4 + ch % 3, pan);
        const bool enabled = variant || (ch != 0 && ch != 3);
        double left_energy = 0, right_energy = 0;
        for (int i = 0; i < 1024; ++i) {
            NativeYm2610BState state{}; NativeYm2610BExtraState metadata{};
            native_ym2610b_get_state(chip, &state); native_ym2610b_get_extra_state(chip, &metadata);
            assert(state.variant == variant && metadata.variant == variant);
            // Snapshot retains the authored raw key command even for a
            // physically absent slot; the variant mask governs actual PCM.
            if (extra) assert(metadata.keys[ch] == 15);
            float l, r; native_ym2610b_sample(chip, &l, &r); assert(std::isfinite(l) && std::isfinite(r));
            left_energy += std::abs(l); right_energy += std::abs(r);
        }
        assert(enabled && (pan & 0x80) ? left_energy > 1 : left_energy == 0);
        assert(enabled && (pan & 0x40) ? right_energy > 1 : right_energy == 0);
        native_ym2610b_stop(chip); assert(render(chip, 32) == 0);
    }
    native_ym2610b_reset(chip); write(chip, 0, 7, 63); write(chip, 0, 8, 15);
    assert(render(chip, 4) > 0); assert(native_ym2610b_set_clock(chip, 100000));
    native_ym2610b_reset(chip);
    float l, r; native_ym2610b_sample(chip, &l, &r); assert(l == 0 && r == 0);
    // Both profiles clear the output-rate hold/remainder. Core resampler
    // history can survive reset, and is compared separately to real WASM.
    render(chip, 128); native_ym2610b_stop(chip); assert(render(chip, 64) == 0);
    audit = false; assert(!allocations && !frees); native_ym2610b_destroy(chip);
}
struct PageVersion { uint8_t bank; uint16_t index; void *ptr; };
struct Pages {
    void *slots[2][256] = {};
    std::vector<void *> owned;
    explicit Pages(void *) {}
    std::vector<PageVersion> prepare(uint8_t bank, uint32_t offset, const uint8_t *bytes, uint32_t size) {
        assert(bank < 2 && offset <= 0x1000000 && size <= 0x1000000 - offset);
        std::vector<PageVersion> result;
        if (!size) return result;
        result.reserve((offset % 65536 + size + 65535) / 65536);
        while (size) {
            const uint16_t index = offset / 65536;
            auto *p = native_ym2610b_alloc_rom_page(); assert(p); owned.push_back(p);
            if (slots[bank][index]) std::memcpy(p, slots[bank][index], 65536);
            const uint32_t count = std::min(size, 65536 - offset % 65536);
            std::memcpy(static_cast<uint8_t *>(p) + offset % 65536, bytes, count);
            slots[bank][index] = p; result.push_back({bank, index, p});
            bytes += count; offset += count; size -= count;
        }
        return result;
    }
    void forget(uint8_t bank) { for (auto &page : slots[bank]) page = nullptr; }
    static void publish(void *chip, const std::vector<PageVersion> &pages) {
        for (const auto &p : pages) assert(native_ym2610b_install_rom_page(chip, p.bank, p.index, p.ptr));
    }
    ~Pages() { for (void *p : owned) native_ym2610b_free_rom_page(p); }
};
static int self_test() {
    assert(!native_ym2610b_create(0, 1)); assert(!native_ym2610b_create(48000, 2));
    static_assert(sizeof(NativeYm2610BState) == 524, "primary state ABI");
    static_assert(sizeof(NativeYm2610BExtraState) == 536, "additional state ABI");
    assert(!native_ym2610b_create_extra(0));
    assert(!native_ym2610b_create(7999, 0) && !native_ym2610b_create(384001, 1));
    assert(!native_ym2610b_create_extra_variant(7999, 0) && !native_ym2610b_create_extra_variant(384001, 1));
    for (uint8_t variant = 0; variant < 2; ++variant) {
        void *chip = native_ym2610b_create(48000, variant); assert(chip);

        uint8_t bytes[256], readback[256];
        for (uint32_t i = 0; i < 256; ++i) bytes[i] = static_cast<uint8_t>(i * 7);
        NativeYm2610BState state{};
        audit = true;
        for (uint8_t type = 0; type < 2; ++type) {
            assert(native_ym2610b_load_rom(chip, type, bytes, 0xffff00, 256));
            assert(native_ym2610b_load_rom(chip, type, bytes, 0x1000000, 0));
            assert(!native_ym2610b_load_rom(chip, type, bytes, 0xffff01, 256));
            assert(!native_ym2610b_load_rom(chip, type, nullptr, 0, 1));
            assert(native_ym2610b_copy_rom(chip, type, readback, 0xffff00, 256));
            assert(std::memcmp(bytes, readback, 256) == 0);
            assert(native_ym2610b_load_rom(chip, type, nullptr, 0x1000000, 0));
            assert(native_ym2610b_copy_rom(chip, type, nullptr, 0x1000000, 0));
            assert(!native_ym2610b_load_rom(chip, type, bytes, 0x1000001, 0));
            assert(!native_ym2610b_copy_rom(chip, type, readback, 0x1000001, 0));
            assert(!native_ym2610b_copy_rom(chip, type, nullptr, 0, 1));
            assert(!native_ym2610b_load_rom(chip, type, bytes, 0xffffffffu, 256));
            assert(!native_ym2610b_load_rom(chip, type, bytes, 0, 0xffffffffu));
            std::memset(readback, 0xa5, sizeof readback);
            assert(!native_ym2610b_copy_rom(chip, type, readback, 0xffff01, 256));
            for (auto value : readback) assert(value == 0xa5);
            assert(native_ym2610b_copy_rom(chip, type, readback, 0xffff00, 256));
            assert(std::memcmp(bytes, readback, 256) == 0);
        }
        uint8_t original[256]; std::memcpy(original, bytes, sizeof bytes); std::memset(bytes, 0, sizeof bytes);
        for (uint8_t type = 0; type < 2; ++type) {
            assert(native_ym2610b_copy_rom(chip, type, readback, 0xffff00, 256));
            assert(!std::memcmp(original, readback, 256)); // Dense upload owns a byte copy.
        }
        std::memcpy(bytes, original, sizeof bytes);
        assert(!native_ym2610b_load_rom(chip, 2, bytes, 0, 1));
        assert(!native_ym2610b_copy_rom(chip, 2, readback, 0, 1));
        assert(native_ym2610b_set_clock(chip, 100000)); assert(native_ym2610b_set_clock(chip, 100000000));
        assert(!native_ym2610b_set_clock(chip, 1)); assert(!native_ym2610b_set_clock(chip, 100000001));
        assert(native_ym2610b_set_clock(chip, 7987200));
        native_ym2610b_set_source_mute_mask(chip, 5);
        fm(chip, 1);
        write(chip, 0, 0xa4, 0x22); write(chip, 1, 0xa1, 0x77);
        native_ym2610b_get_state(chip, &state);
        assert(state.registers[0x1a5] == 0x22 && state.registers[0x1a1] == 0x77);
        write(chip, 0, 0, 0x34); write(chip, 0, 1, 2); write(chip, 0, 7, 0x3e); write(chip, 0, 8, 12);
        write(chip, 0, 0x12, 0x12); write(chip, 0, 0x19, 0x34); write(chip, 1, 8, 0xde);
        assert(render(chip, 4000) > 1);
        native_ym2610b_stop(chip); native_ym2610b_get_state(chip, &state);
        assert(state.variant == variant && state.clock == 7987200 && state.source_mute_mask == 5);
        assert(state.registers[0xb1] == 7 && state.registers[0x108] == 0xde);
        assert(state.registers[0x1a5] == 0x22 && state.registers[0x1a1] == 0x77);
        assert(state.registers[0] == 0x34 && state.registers[1] == 2 && state.registers[8] == 0);
        assert(state.registers[0x12] == 0x12 && state.registers[0x19] == 0x34);
        for (uint8_t type = 0; type < 2; ++type) {
            assert(native_ym2610b_copy_rom(chip, type, readback, 0xffff00, 256));
            assert(!std::memcmp(bytes, readback, 256)); // Stop retains both complete banks.
        }
        assert(render(chip, 256) == 0);
        write(chip, 0, 0x28, 0xf1); assert(render(chip, 256) > 0.1);
        native_ym2610b_reset(chip); native_ym2610b_get_state(chip, &state);
        assert(state.clock == 7987200 && state.source_mute_mask == 5 && state.registers[0xb1] == 0);
        for (uint8_t type = 0; type < 2; ++type) {
            assert(native_ym2610b_copy_rom(chip, type, readback, 0xffff00, 256));
            assert(std::memcmp(bytes, readback, 256) == 0);
        }
        // Independent bank clear does not touch the other bank.
        native_ym2610b_clear_rom(chip, 0);
        assert(native_ym2610b_copy_rom(chip, 0, readback, 0xffff00, 256));
        for (auto value : readback) assert(value == 0);
        assert(native_ym2610b_copy_rom(chip, 1, readback, 0xffff00, 256)); assert(std::memcmp(bytes, readback, 256) == 0);
        native_ym2610b_load_rom(chip, 0, bytes, 0xffff00, 256);
        write(chip, 0, 0, 0x55); assert(native_ym2610b_read(chip, 1) == 0x55);
        // YM2610's extended status/EOS reads are observational; ID and I/O
        // reads follow the real hardware bus implementation.
        write(chip, 0, 0xff, 0); assert(native_ym2610b_read(chip, 1) == 1);
        write(chip, 0, 0x0e, 0); assert(native_ym2610b_read(chip, 1) == 255);
        write(chip, 0, 0x24, 255); write(chip, 0, 0x25, 3); write(chip, 0, 0x27, 5);
        render(chip, 128); native_ym2610b_get_state(chip, &state);
        assert((state.status & 1) && state.irq);
        for (int i = 0; i < 100; ++i) native_ym2610b_get_state(chip, &state);
        assert((state.status & 1) && state.irq);
        assert(native_ym2610b_read_status(chip) == state.status);
        write(chip, 0, 0x27, 0x10); native_ym2610b_get_state(chip, &state);
        assert(!(state.status & 1) && !state.irq);
        native_ym2610b_set_source_mute_mask(chip, 0);
        // Both decoders reach their own EOS flag through the final 256-byte
        // ROM block. Reads do not acknowledge flags; register 1C masks/clears.
        for (uint8_t ch = 0; ch < 6; ++ch) {
            write(chip, 1, 0x10 + ch, 255); write(chip, 1, 0x18 + ch, 255);
            write(chip, 1, 0x20 + ch, 255); write(chip, 1, 0x28 + ch, 255);
            write(chip, 1, 8 + ch, 0xdf);
        }
        write(chip, 1, 1, 63); write(chip, 1, 0, 63);
        for (uint8_t reg : {0x12, 0x13, 0x14, 0x15, 0x19, 0x1a, 0x1b}) write(chip, 0, reg, 255);
        write(chip, 0, 0x11, 0xc0); write(chip, 0, 0x10, 0xa0);
        assert(render(chip, 6000) > 1);
        native_ym2610b_get_state(chip, &state); assert((state.status_hi & 0xbf) == 0xbf);
        for (int i = 0; i < 100; ++i) assert(native_ym2610b_read_status_hi(chip) == 0xbf);
        write(chip, 0, 0x1c, 0x81); assert(native_ym2610b_read_status_hi(chip) == 0x3e);
        native_ym2610b_get_state(chip, &state); assert(state.status_hi == 0x3e);
        write(chip, 0, 0x1c, 0); assert(native_ym2610b_read_status_hi(chip) == 0x3e);
        for (uint8_t voice = 0; voice < 16; ++voice) native_ym2610b_key_off(chip, voice);
        // Missing YM2610 FM channels remain silent; the B variant enables them.
        native_ym2610b_reset(chip); fm(chip, 0);
        const double masked = render(chip, 1000); assert(variant ? masked > 1 : masked == 0);
        native_ym2610b_clear_rom(chip, 0); native_ym2610b_clear_rom(chip, 1);
        audit = false;
        assert(allocations == 0 && frees == 0);
        void *other = native_ym2610b_create(48000, variant); assert(other);
        audit = true;
        assert(native_ym2610b_load_rom(chip, 1, bytes, 0x12345, sizeof bytes));
        assert(native_ym2610b_copy_rom(other, 1, readback, 0x12345, sizeof readback));
        for (auto value : readback) assert(!value);
        native_ym2610b_clear_rom(other, 1); native_ym2610b_reset(other);
        assert(native_ym2610b_copy_rom(chip, 1, readback, 0x12345, sizeof readback));
        assert(!std::memcmp(bytes, readback, sizeof bytes));
        audit = false; assert(!allocations && !frees); native_ym2610b_destroy(other);
        native_ym2610b_destroy(chip);
        physical_channels_and_reset(false, variant);
    }
    std::puts("YM2610/YM2610B variant/status/EOS/Stop/reset/independent ROM self-test passed; callback allocations 0, frees 0");
    return 0;
}
static int extra_self_test(uint8_t tested_variant) {
    static_assert(sizeof(NativeYm2610BExtraState) == 536, "additional ABI");
    assert(!native_ym2610b_create_extra(0));
    void *first = native_ym2610b_create_extra_variant(48000, tested_variant), *reference = native_ym2610b_create_extra_variant(48000, tested_variant); assert(first && reference);
    Pages pages(first), reference_pages(reference);
    uint8_t data[8192], copied[8192]; for (uint32_t i = 0; i < sizeof data; ++i) data[i] = uint8_t(i * 13 + 7);
    auto a = pages.prepare(0, 0, data, sizeof data), b = pages.prepare(1, 0, data, sizeof data);
    auto a_reference = reference_pages.prepare(0, 0, data, sizeof data), b_reference = reference_pages.prepare(1, 0, data, sizeof data);
    auto boundary = pages.prepare(0, 65536 - 128, data, 256);
    const auto *old_version = static_cast<const uint8_t *>(a[0].ptr);
    std::vector<uint8_t> full_rom(0x1000000, 0x5a);
    auto full_publication = pages.prepare(0, 0, full_rom.data(), full_rom.size()); assert(full_publication.size() == 256);
    audit = true;
    assert(!native_ym2610b_load_rom(first, 0, data, 0, sizeof data));
    for (uint8_t bank = 0; bank < 2; ++bank) {
        assert(native_ym2610b_load_rom(first, bank, nullptr, 0x1000000, 0));
        assert(native_ym2610b_copy_rom(first, bank, nullptr, 0x1000000, 0));
        assert(!native_ym2610b_load_rom(first, bank, nullptr, 0, 1));
        assert(!native_ym2610b_load_rom(first, bank, data, 0x1000001, 0));
        assert(!native_ym2610b_copy_rom(first, bank, nullptr, 0, 1));
        assert(!native_ym2610b_copy_rom(first, bank, copied, 0x1000001, 0));
        std::memset(copied, 0xa5, sizeof copied);
        assert(!native_ym2610b_copy_rom(first, bank, copied, 0xffffff, sizeof copied));
        for (auto value : copied) assert(value == 0xa5);
        assert(native_ym2610b_copy_rom(first, bank, copied, 65536 - 128, 256));
        for (uint32_t i = 0; i < 256; ++i) assert(!copied[i]); // Missing pages span as zero.
    }
    assert(native_ym2610b_copy_rom(first, 0, copied, 0, sizeof copied)); for (auto v : copied) assert(!v);
    Pages::publish(first, a); Pages::publish(first, b);
    assert(native_ym2610b_copy_rom(reference, 0, copied, 0, sizeof copied)); for (auto v : copied) assert(!v);
    Pages::publish(reference, a_reference); Pages::publish(reference, b_reference);
    Pages::publish(first, boundary);
    assert(native_ym2610b_copy_rom(first, 0, copied, 65536 - 128, 256)); assert(!std::memcmp(copied, data, 256));
    assert(!std::memcmp(old_version, data, sizeof data)); // New versions never mutate old storage.
    assert(!native_ym2610b_install_rom_page(first, 2, 0, a[0].ptr));
    assert(!native_ym2610b_install_rom_page(first, 0, 256, a[0].ptr));
    assert(!native_ym2610b_install_rom_page(first, 0, 0, nullptr));
    assert(native_ym2610b_install_rom_page(first, 0, 0, a[0].ptr)); // Replacement and idempotent publication.
    assert(native_ym2610b_install_rom_page(first, 0, 0, a[0].ptr));
    for (void *p : {first, reference}) {
        fm(p, 4);
        write(p, 0, 0, 0x34); write(p, 0, 1, 2); write(p, 0, 7, 0x3e); write(p, 0, 8, 12);
        write(p, 1, 1, 63);
        for (uint8_t ch = 0; ch < 6; ++ch) { write(p, 1, 0x10 + ch, 0); write(p, 1, 0x18 + ch, 0); write(p, 1, 0x20 + ch, 0); write(p, 1, 0x28 + ch, 0); write(p, 1, 8 + ch, 0xdf); }
        write(p, 1, 0, 63);
        write(p, 0, 0x11, 0xc0); write(p, 0, 0x12, 0); write(p, 0, 0x13, 0); write(p, 0, 0x14, 31); write(p, 0, 0x15, 0);
        write(p, 0, 0x19, 0); write(p, 0, 0x1a, 0x40); write(p, 0, 0x1b, 180); write(p, 0, 0x10, 0xb0);
    }
    for (uint32_t clock : {8000000u, 100000u, 8000000u}) {
        fm(first, 1); assert(native_ym2610b_set_clock(first, clock)); assert(native_ym2610b_set_clock(reference, clock));
        for (uint32_t frame = 0; frame < 4096; ++frame) {
            if (frame == 701) native_ym2610b_key_off(first, 1);
            if (frame == 1703) { native_ym2610b_key_off(first, 2); write(first, 0, 0x41, 7); }
            if (frame == 2801) native_ym2610b_key_off(first, 5);
            NativeYm2610BExtraState inspected{}; native_ym2610b_get_extra_state(first, &inspected);
            float l, r, expected_l, expected_r; native_ym2610b_sample(first, &l, &r); native_ym2610b_sample(reference, &expected_l, &expected_r);
            if (frame >= 701) assert(l == expected_l && r == expected_r);
        }
    }
    NativeYm2610BExtraState meta{};
    write(first, 0, 0x28, 0xa2); write(first, 0, 8, 16); write(first, 0, 0x27, 0x8f);
    native_ym2610b_cancel_csm(first); native_ym2610b_get_extra_state(first, &meta);
    assert(meta.keys[2] == 10 && !(meta.registers[0x27] & 0x81) && (meta.registers[0x27] & 2));
    write(first, 0, 0x27, 0x8f); native_ym2610b_key_off_fm(first, 2); native_ym2610b_get_extra_state(first, &meta);
    assert(!meta.keys[2] && (meta.registers[0x27] & 0x81) == 0x81);
    native_ym2610b_cancel_csm(first); native_ym2610b_key_off(first, 6); native_ym2610b_get_extra_state(first, &meta);
    assert(!(meta.registers[0x27] & 0x81) && meta.ssg_levels[0] == 16 && meta.registers[8] == 0);
    native_ym2610b_set_retained_ssg_level(first, 0, 0); native_ym2610b_get_extra_state(first, &meta); assert(meta.ssg_levels[0] == 0);
    native_ym2610b_audition_fm_key_on(first, 1, 5); native_ym2610b_stop(first); assert(render(first, 200) == 0);
    native_ym2610b_get_extra_state(first, &meta); assert(!meta.keys[1]);
    for (uint8_t bank = 0; bank < 2; ++bank) {
        assert(native_ym2610b_copy_rom(first, bank, copied, 0, sizeof copied));
        assert(!std::memcmp(copied, data, sizeof data));
    }
    native_ym2610b_audition_fm_key_on(first, 1, 5); native_ym2610b_reset(first); render(first, 200);
    native_ym2610b_get_extra_state(first, &meta); assert(!meta.keys[1] && meta.variant == tested_variant);
    native_ym2610b_clear_rom(first, 0); assert(native_ym2610b_copy_rom(first, 0, copied, 0, sizeof copied)); for (auto v : copied) assert(!v);
    assert(!std::memcmp(old_version, data, sizeof data));
    assert(native_ym2610b_copy_rom(first, 1, copied, 0, sizeof copied)); assert(!std::memcmp(copied, data, sizeof data));
    assert(native_ym2610b_copy_rom(reference, 0, copied, 0, sizeof copied)); assert(!std::memcmp(copied, data, sizeof data));
    Pages::publish(first, full_publication);
    for (uint32_t index = 0; index < 256; ++index) { assert(native_ym2610b_copy_rom(first, 0, copied, index * 65536 + 65535, 1)); assert(copied[0] == 0x5a); }
    assert(!std::memcmp(old_version, data, sizeof data));
    audit = false; assert(!allocations && !frees);
    native_ym2610b_destroy(first); native_ym2610b_destroy(reference);
    assert(!std::memcmp(old_version, data, sizeof data)); // Destroy never frees caller-owned pages.
    physical_channels_and_reset(true, tested_variant);
    assert(!native_ym2610b_create_extra_variant(48000, 2));
    for (uint8_t variant = 0; variant < 2; ++variant) for (uint8_t ch : {uint8_t(0), uint8_t(3)}) {
        void *full = native_ym2610b_create_extra_variant(48000, variant); assert(full);
        fm(full, ch);
        audit = true;
        assert(variant ? render(full, 1000) > 1 : render(full, 1000) == 0);
        native_ym2610b_key_off_fm(full, ch);
        native_ym2610b_audition_fm_key_on(full, ch, 15);
        const double manual = render(full, 1000);
        assert(variant ? manual > 1 : manual == 0);
        NativeYm2610BExtraState state{}; native_ym2610b_get_extra_state(full, &state);
        assert(state.variant == variant && (variant ? state.keys[ch] == 15 : !state.keys[ch]));
        native_ym2610b_stop(full); assert(render(full, 100) == 0);
        native_ym2610b_reset(full); native_ym2610b_get_extra_state(full, &state);
        assert(state.variant == variant && !state.keys[ch]);
        audit = false;
        assert(!allocations && !frees);
        native_ym2610b_destroy(full);
    }
    std::puts("Additional YM2610/YM2610B immutable sparse pages/isolation/cancel/CSM/snapshot self-test passed; callback allocations 0, frees 0");
    return 0;
}
struct Event { uint32_t frame = 0, a = 0, b = 0, c = 0; std::string op; std::vector<uint8_t> bytes; std::vector<PageVersion> pages; };
int main(int argc, char **argv) {
    try {
        const bool extra = argc > 1 && std::string(argv[1]) == "--extra";
        if (extra) { --argc; ++argv; }
        if (argc == 2 && std::string(argv[1]) == "--self-test") { self_test(); extra_self_test(0); extra_self_test(1); return 0; }
        if (argc != 4) return 2;
        const uint32_t rate = std::stoul(argv[1]), frames = std::stoul(argv[2]), variant = std::stoul(argv[3]);
        if (frames > 10000000) return 2;
        std::vector<Event> events;
        std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream in(line); Event event;
            if (!(in >> event.frame >> event.op)) continue;
            if (event.op == "write") in >> event.a >> event.b >> event.c;
            else if (event.op == "clock" || event.op == "mute" || event.op == "off") in >> event.a;
            else if (event.op == "rom") {
                std::string hex; in >> event.a >> event.b >> hex; assert(hex.size() % 2 == 0);
                for (size_t i = 0; i < hex.size(); i += 2) event.bytes.push_back(std::stoul(hex.substr(i, 2), nullptr, 16));
            }
            else if (event.op == "clear") in >> event.a;
            else if (event.op != "reset" && event.op != "stop") return 2;
            events.push_back(std::move(event));
        }
        std::stable_sort(events.begin(), events.end(), [](const Event &a, const Event &b) { return a.frame < b.frame; });
        void *chip = extra ? native_ym2610b_create_extra_variant(rate, variant) : native_ym2610b_create(rate, variant); if (!chip) return 3;
        Pages pages(chip);
        if (extra) for (auto &e : events) {
            if (e.op == "rom") e.pages = pages.prepare(e.a, e.b, e.bytes.data(), e.bytes.size());
            else if (e.op == "clear") pages.forget(e.a);
        }
        const uint32_t planes = extra ? 9 : 2;
        std::vector<float> pcm(frames * planes);
        size_t next = 0;
        audit = true;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            while (next < events.size() && events[next].frame == frame) {
                const auto &e = events[next++];
                if (e.op == "write") write(chip, e.a, e.b, e.c);
                else if (e.op == "clock") assert(native_ym2610b_set_clock(chip, e.a));
                else if (e.op == "mute") native_ym2610b_set_source_mute_mask(chip, e.a);
                else if (e.op == "off") native_ym2610b_key_off(chip, e.a);
                else if (e.op == "rom") { if (extra) Pages::publish(chip, e.pages); else assert(native_ym2610b_load_rom(chip, e.a, e.bytes.data(), e.b, e.bytes.size())); }
                else if (e.op == "clear") native_ym2610b_clear_rom(chip, e.a);
                else if (e.op == "reset") native_ym2610b_reset(chip);
                else if (e.op == "stop") native_ym2610b_stop(chip);
            }
            native_ym2610b_sample(chip, &pcm[frame * planes], &pcm[frame * planes + 1]);
            if (extra) {
                pcm[frame * planes + 2] = native_ym2610b_read_status(chip);
                pcm[frame * planes + 3] = native_ym2610b_read_status_hi(chip);
                pcm[frame * planes + 4] = native_ym2610b_get_irq(chip);
                for (uint8_t port = 0; port < 4; ++port) pcm[frame * planes + 5 + port] = native_ym2610b_read(chip, port);
            }
        }
        audit = false;
        assert(allocations == 0 && frees == 0);
        native_ym2610b_destroy(chip);
        return std::fwrite(pcm.data(), sizeof(float), pcm.size(), stdout) == pcm.size() ? 0 : 4;
    } catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; }
}
