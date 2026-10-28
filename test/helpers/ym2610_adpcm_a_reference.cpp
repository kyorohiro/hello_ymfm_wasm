// Offline test transport for the actual vendored ymfm decoder and chip wrapper.
// No ADPCM arithmetic is duplicated here and no production API is changed.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "ymfm.h"
#define private public
#include "ymfm_adpcm.h"
#undef private

extern "C" {
void *ym2610b_create_variant(uint32_t variant);
void ym2610b_destroy(void *chip);
void ym2610b_reset(void *chip);
void ym2610b_write(void *chip, uint32_t offset, uint8_t value);
uint8_t ym2610b_read_status_hi(void *chip);
int ym2610b_load_rom(void *chip, uint32_t type, uint32_t size, uint32_t offset, const uint8_t *data, uint32_t length);
void ym2610b_clear_roms(void *chip);
void ym2610b_generate(void *chip, float *left, float *right, uint32_t frames);
}

static unsigned read_le(unsigned count) {
    unsigned value = 0;
    for (unsigned i = 0; i < count; ++i) {
        int byte = std::getchar();
        if (byte == EOF) std::exit(2);
        value |= unsigned(byte) << (8 * i);
    }
    return value;
}
static void sample(int value) {
    unsigned bits = static_cast<uint16_t>(value);
    std::putchar(bits & 255); std::putchar(bits >> 8);
}
struct Rom : ymfm::ymfm_interface {
    std::vector<uint8_t> data;
    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override {
        if (type != ymfm::ACCESS_ADPCM_A || address >= data.size()) return 0;
        return data[address];
    }
};
static int decode() {
    unsigned cases = read_le(4);
    while (cases--) {
        unsigned length = read_le(4);
        if (!length || length % 256 || length >= 0x100000) return 3;
        Rom rom; rom.data.resize(length);
        for (auto &byte : rom.data) byte = read_le(1);
        ymfm::adpcm_a_engine decoder(rom, 8); decoder.reset();
        decoder.set_start_end(0, 0, length / 256 - 1);
        decoder.write(0, 1);
        for (unsigned frame = 0; frame < length * 2; ++frame) {
            if (decoder.clock(1)) return 4; // Inclusive end includes both nibbles.
            int value = decoder.m_channel[0]->m_accumulator;
            sample(value >= 2048 ? value - 4096 : value);
        }
        if (decoder.clock(1) != 1 || decoder.m_channel[0]->m_accumulator != 0) return 5;
    }
    return std::ferror(stdout) ? 6 : 0;
}
static int playback() {
    unsigned variant = read_le(1), commands = read_le(4);
    if (variant > 1) return 3;
    void *chip = ym2610b_create_variant(variant);
    float left[1024], right[1024];
    while (commands--) {
        unsigned op = read_le(1);
        if (op == 0) ym2610b_reset(chip);
        else if (op == 1) {
            unsigned type = read_le(1), offset = read_le(4), length = read_le(4), size = read_le(4);
            std::vector<uint8_t> bytes(length);
            for (auto &byte : bytes) byte = read_le(1);
            if (!ym2610b_load_rom(chip, type, size, offset, bytes.data(), length)) return 4;
        } else if (op == 2) {
            unsigned port = read_le(1), reg = read_le(1), value = read_le(1);
            ym2610b_write(chip, port * 2, reg); ym2610b_write(chip, port * 2 + 1, value);
        } else if (op == 3) {
            unsigned frames = read_le(4);
            while (frames) {
                unsigned count = std::min(frames, 1024u);
                ym2610b_generate(chip, left, right, count);
                for (unsigned i = 0; i < count; ++i) { sample(int(left[i] * 32768)); sample(int(right[i] * 32768)); }
                frames -= count;
            }
        } else if (op == 4) std::putchar(ym2610b_read_status_hi(chip));
        else if (op == 5) ym2610b_clear_roms(chip);
        else return 5;
    }
    ym2610b_destroy(chip);
    return std::ferror(stdout) ? 6 : 0;
}
int main(int argc, char **argv) {
    if (argc != 2) return 1;
    return std::strcmp(argv[1], "raw") == 0 ? decode() :
        std::strcmp(argv[1], "audio") == 0 ? playback() : 1;
}
