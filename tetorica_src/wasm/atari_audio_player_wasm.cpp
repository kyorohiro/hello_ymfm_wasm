// SPDX-License-Identifier: BSD-3-Clause
// Isolated, bounded host for the pinned AtariAudio source in third_party/atari-audio.
#include "../../third_party/atari-audio/src/AtariAudioRenderer.h"
#include "../../third_party/atari-audio/src/external/lzh.h"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <emscripten/emscripten.h>
#include <vector>

namespace {
constexpr uint32_t kSampleRate = 44100;
constexpr uint32_t kMaxFileBytes = 8 * 1024 * 1024;
constexpr uint32_t kMaxSndhBytes = 4 * 1024 * 1024 - 0x10002;
constexpr uint32_t kMaxFrames = 4096;
AtariAudioRenderer* renderer = nullptr;
int16_t output[kMaxFrames] = {};
uint32_t frame = 0;
uint32_t duration = 0;
bool initialized = false;
const char* errorMessage = "";

uint16_t be16(const uint8_t* p) { return (uint16_t(p[0]) << 8) | p[1]; }
uint32_t be32(const uint8_t* p) { return (uint32_t(be16(p)) << 16) | be16(p + 2); }
uint32_t le32(const uint8_t* p) { return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24); }
bool is(const uint8_t* p, const char* s, size_t count) { return std::memcmp(p, s, count) == 0; }
bool fail(const char* message) { errorMessage = message; return false; }

bool skipString(const uint8_t* data, size_t size, size_t& pos) {
    const size_t end = std::min(size, pos + 4097);
    while (pos < end && data[pos]) ++pos;
    if (pos == end) return fail("Unterminated or oversized metadata string");
    ++pos;
    return true;
}

bool validateYm(const uint8_t* data, size_t size) {
    if (size < 18) return fail("Truncated YM file");
    if (is(data, "YM2!", 4) || is(data, "YM3!", 4) || is(data, "YM3b", 4)) {
        const size_t trailer = is(data, "YM3b", 4) ? 4 : 0;
        if ((size - 4 - trailer) % 14 || size < 18 + trailer) return fail("Invalid YM register stream length");
        return true;
    }
    if (size < 34 || !(is(data, "YM5!", 4) || is(data, "YM6!", 4)) || !is(data + 4, "LeOnArD!", 8)) {
        return fail("Supported YM versions are YM2, YM3, YM3b, YM5 and YM6");
    }
    const uint32_t ticks = be32(data + 12);
    const uint16_t samples = be16(data + 20);
    const uint32_t clock = be32(data + 22);
    const uint16_t rate = be16(data + 26);
    if (!ticks || ticks > 2000000 || samples > 64 || clock < 100000 || clock > 8000000 || !rate || rate > 1000) {
        return fail("Invalid YM timing, clock or sample count");
    }
    if (uint64_t(ticks) * kSampleRate / rate > 0xffffffffu) return fail("YM duration exceeds the native sample counter");
    size_t pos = 34 + be16(data + 32);
    if (pos > size) return fail("Truncated YM extension");
    for (unsigned i = 0; i < samples; ++i) {
        if (size - pos < 4) return fail("Truncated YM sample length");
        const uint32_t count = be32(data + pos);
        pos += 4;
        if (count > size - pos) return fail("Invalid YM sample length");
        pos += count;
    }
    for (unsigned i = 0; i < 3; ++i) if (!skipString(data, size, pos)) return false;
    if (uint64_t(ticks) * 16 > size - pos) return fail("Truncated YM register stream");
    return true;
}

// Check every variable-length field before entering the upstream header parser.
bool validateSndh(const uint8_t* data, size_t size) {
    if (size < 20 || size > kMaxSndhBytes || data[0] != 0x60 || !is(data + 12, "SNDH", 4)) return fail("Invalid SNDH header or size");
    const size_t headerEnd = (data[1] ? data[1] : be16(data + 2)) + 2;
    if (headerEnd < 20 || headerEnd > size || data[1] >= 128) return fail("Invalid SNDH initialization branch");
    size_t pos = 16;
    unsigned subsongs = 1;
    unsigned tickRate = 50;
    uint32_t maximumFrameTicks = 0;
    bool foundTag = false;
    const auto finish = [&]() {
        if (!foundTag) return fail("SNDH has no metadata tags");
        const uint64_t samplesPerTick = uint64_t(kSampleRate) * 313 * 512 * 50 / (uint64_t(tickRate) * 8021247);
        if (uint64_t(maximumFrameTicks) * samplesPerTick > 0xffffffffu) return fail("SNDH duration exceeds the native sample counter");
        return true;
    };
    while (pos + 4 <= headerEnd) {
        if (is(data + pos, "HDNS", 4)) return finish();
        if (is(data + pos, "#!SN", 4)) {
            pos += 4 + subsongs * 2;
            if (pos > headerEnd) return fail("Truncated SNDH subsong names");
            foundTag = true;
            continue;
        }
        if (is(data + pos, "##", 2)) {
            if (data[pos + 2] < '0' || data[pos + 2] > '9' || data[pos + 3] < '0' || data[pos + 3] > '9') return fail("Invalid SNDH subsong count");
            subsongs = (data[pos + 2] - '0') * 10 + data[pos + 3] - '0';
            if (!subsongs) return fail("SNDH subsong count is zero");
            pos += 4;
            foundTag = true;
            continue;
        }
        if (is(data + pos, "TIME", 4) || is(data + pos, "FRMS", 4)) {
            const bool frames = is(data + pos, "FRMS", 4);
            pos += 4;
            if (!frames && (pos & 1)) ++pos;
            const size_t start = pos;
            pos += subsongs * (frames ? 4 : 2);
            if (pos > headerEnd) return fail("Truncated SNDH duration table");
            if (frames) {
                for (unsigned i = 0; i < subsongs; ++i) maximumFrameTicks = std::max(maximumFrameTicks, be32(data + start + i * 4));
            }
            foundTag = true;
            continue;
        }
        const bool timer = is(data + pos, "TA", 2) || is(data + pos, "TB", 2) || is(data + pos, "TC", 2) || is(data + pos, "TD", 2) || is(data + pos, "!V", 2);
        const bool number = timer || is(data + pos, "#!", 2);
        const bool text = is(data + pos, "TITL", 4) || is(data + pos, "COMM", 4) || is(data + pos, "RIPP", 4) || is(data + pos, "CONV", 4) || is(data + pos, "YEAR", 4);
        if (number || text) {
            pos += number ? 2 : 4;
            const size_t start = pos;
            if (!skipString(data, headerEnd, pos)) return false;
            if (number) {
                unsigned value = 0;
                for (size_t i = start; i + 1 < pos; ++i) {
                    if (data[i] < '0' || data[i] > '9' || value > 1000) return fail("Invalid SNDH numeric tag");
                    value = value * 10 + data[i] - '0';
                }
                if (timer && (!value || value > 1000)) return fail("Invalid SNDH tick rate");
                if (timer) tickRate = value;
            }
            foundTag = true;
        } else {
            ++pos;
        }
    }
    return finish();
}

// Bounds-checked version of the public-domain Hans Wessels ICE 2.4 decoder.
class IceReader {
public:
    IceReader(const uint8_t* input, size_t length) : data(input), pos(length) {}
    bool byte(uint8_t& value) {
        if (pos <= 12) return false;
        value = data[--pos];
        return true;
    }
    bool bits(unsigned count, unsigned& value) {
        value = 0;
        while (count--) {
            mask >>= 1;
            if (!mask) {
                if (!byte(command)) return false;
                mask = 0x80;
            }
            value = value * 2 + ((command & mask) ? 1 : 0);
        }
        return true;
    }
    bool start() {
        unsigned ignored;
        if (!bits(1, ignored) || !command) return false;
        mask = 0x80;
        while (!(command & 1)) { command >>= 1; mask >>= 1; }
        command >>= 1;
        return true;
    }
private:
    const uint8_t* data;
    size_t pos;
    unsigned mask = 0;
    uint8_t command = 0;
};

bool unpackIce(const uint8_t* data, size_t size, std::vector<uint8_t>& out) {
    if (size < 13 || be32(data + 4) != size || !be32(data + 8) || be32(data + 8) > kMaxSndhBytes) return fail("Invalid ICE packed or expanded size");
    out.resize(be32(data + 8));
    IceReader reader(data, size);
    if (!reader.start()) return fail("Invalid ICE bitstream");
    size_t pos = out.size();
    while (pos) {
        unsigned bit;
        if (!reader.bits(1, bit)) return fail("Truncated ICE bitstream");
        if (bit) {
            const unsigned widths[] = {1, 2, 2, 3, 8, 15};
            const unsigned maxima[] = {1, 3, 3, 7, 255, 32768};
            const unsigned offsets[] = {1, 2, 5, 8, 15, 270};
            unsigned index = 0, count;
            do {
                if (!reader.bits(widths[index], count)) return fail("Truncated ICE literals");
                if (count != maxima[index]) break;
            } while (++index < 6);
            if (index == 6) return fail("Invalid ICE literal length");
            count = std::min<size_t>(count + offsets[index], pos);
            while (count--) if (!reader.byte(out[--pos])) return fail("Truncated ICE literals");
            if (!pos) break;
        }
        const unsigned widths[] = {0, 0, 1, 2, 10};
        const unsigned offsets[] = {0, 1, 2, 4, 8};
        unsigned index = 0;
        while (index < 4) {
            if (!reader.bits(1, bit)) return fail("Truncated ICE match");
            if (!bit) break;
            ++index;
        }
        unsigned length;
        if (!reader.bits(widths[index], length)) return fail("Truncated ICE match length");
        length += offsets[index];
        unsigned distance;
        if (length) {
            const unsigned distanceWidths[] = {8, 5, 12};
            const unsigned distanceOffsets[] = {32, 0, 288};
            index = 0;
            while (index < 2) {
                if (!reader.bits(1, bit)) return fail("Truncated ICE distance");
                if (!bit) break;
                ++index;
            }
            if (!reader.bits(distanceWidths[index], distance)) return fail("Truncated ICE distance");
            distance += distanceOffsets[index];
            if (distance) distance += length;
        } else {
            if (!reader.bits(1, bit) || !reader.bits(bit ? 9 : 6, distance)) return fail("Truncated ICE distance");
            if (bit) distance += 64;
        }
        size_t from = pos + distance + 1;
        if (from > out.size()) return fail("Invalid ICE back reference");
        length = std::min<size_t>(length + 2, pos);
        while (length--) out[--pos] = out[--from];
    }
    return true;
}

bool prepare(const uint8_t* data, size_t size, std::vector<uint8_t>& unpacked) {
    if (size < 18 || size > kMaxFileBytes) return fail("Atari file must be between 18 bytes and 8 MiB");
    if (is(data, "ICE!", 4)) {
        if (!unpackIce(data, size, unpacked)) return false;
    } else if (is(data + 2, "-lh5-", 5)) {
        if (size < 25 || data[20] || data[0] != 22 + data[21]) return fail("Unsupported or malformed LHA header");
        const size_t header = 24 + data[21];
        if (header >= size || le32(data + 7) != size - header - 1 || !le32(data + 11) || le32(data + 11) > kMaxFileBytes) return fail("Invalid LHA packed or expanded size");
        LzhDepacker depacker{};
        uint32_t length = 0;
        void* raw = depacker.Unpack(data, size, length);
        if (!raw || !length) return fail("Invalid LHA compressed stream");
        unpacked.assign(static_cast<uint8_t*>(raw), static_cast<uint8_t*>(raw) + length);
        AtariAudioFree(raw);
    }
    if (!unpacked.empty()) { data = unpacked.data(); size = unpacked.size(); }
    if (size >= 16 && data[0] == 0x60 && is(data + 12, "SNDH", 4)) return validateSndh(data, size);
    return validateYm(data, size);
}

void close() {
    if (renderer) AtariAudioRenderer::Destroy(renderer);
    renderer = nullptr;
    frame = duration = 0;
    initialized = false;
}
}

extern "C" {
EMSCRIPTEN_KEEPALIVE void* atari_alloc(uint32_t count) { return count <= kMaxFileBytes ? std::malloc(count) : nullptr; }
EMSCRIPTEN_KEEPALIVE void atari_free(void* p) { std::free(p); }
EMSCRIPTEN_KEEPALIVE void atari_close() { close(); }
EMSCRIPTEN_KEEPALIVE const char* atari_error() { return errorMessage; }
// Subsong zero inspects the file without running any 68000 instructions.
EMSCRIPTEN_KEEPALIVE int atari_open(const uint8_t* data, uint32_t size, uint32_t subsong) {
    close();
    errorMessage = "";
    if (!data) return fail("Missing Atari input");
    std::vector<uint8_t> unpacked;
    if (!prepare(data, size, unpacked)) return 0;
    if (!unpacked.empty()) { data = unpacked.data(); size = unpacked.size(); }
    renderer = AtariAudioRenderer::Create(data, size, kSampleRate);
    if (!renderer) return fail("AtariAudio could not load this file");
    const auto& info = renderer->GetSongInfo();
    if (subsong > uint32_t(info.subsongCount)) return fail("Invalid Atari subsong");
    duration = renderer->GetSubsongDurationSample(subsong ? subsong : info.defaultSubsong);
    if (subsong) {
        if (!renderer->InitSubSong(subsong, true)) return fail("SNDH initialization failed or exceeded its CPU cycle budget");
        initialized = true;
    }
    return 1;
}
EMSCRIPTEN_KEEPALIVE uint32_t atari_clock() { return renderer ? renderer->GetSongInfo().ym2149Clock : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t atari_format() { return renderer && renderer->GetSongInfo().fileType == AtariAudioRenderer::eFileType::eSndh ? 2 : 1; }
EMSCRIPTEN_KEEPALIVE uint32_t atari_subsong_count() { return renderer ? renderer->GetSongInfo().subsongCount : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t atari_default_subsong() { return renderer ? renderer->GetSongInfo().defaultSubsong : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t atari_duration() { return duration; }
EMSCRIPTEN_KEEPALIVE uint32_t atari_subsong_duration(unsigned subsong) { return renderer ? renderer->GetSubsongDurationSample(subsong) : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t atari_frame() { return frame; }
EMSCRIPTEN_KEEPALIVE const char* atari_text(unsigned field) {
    if (!renderer) return "";
    const auto& info = renderer->GetSongInfo();
    switch (field) {
        case 0: return info.musicName;
        case 1: return info.musicAuthor;
        case 2: return info.year;
        case 3: return info.ripper;
        case 4: return info.converter;
        case 5: return info.fileFormat;
        default: return "";
    }
}
EMSCRIPTEN_KEEPALIVE uint32_t atari_register(unsigned reg) { return renderer && initialized && reg < 14 ? renderer->GetYmRegister(reg) : 0; }
EMSCRIPTEN_KEEPALIVE int atari_write_register(unsigned reg, unsigned value) {
    if (!renderer || !initialized || reg >= 14 || value > 255) return 0;
    renderer->WriteYmRegister(reg, static_cast<uint8_t>(value));
    return 1;
}
EMSCRIPTEN_KEEPALIVE const int16_t* atari_output() { return output; }
EMSCRIPTEN_KEEPALIVE int atari_render(uint32_t count) {
    if (!renderer || !initialized) { fail("Atari player is not initialized"); return -1; }
    if (!count || count > kMaxFrames) { fail("Render request must contain 1..4096 frames"); return -1; }
    if (duration) count = std::min(count, duration - std::min(frame, duration));
    if (!count) return 0;
    std::fill(output, output + count, 0);
    renderer->AudioRender(output, count);
    if (!renderer->IsReplayValid()) { fail("SNDH replay failed or exceeded its CPU cycle budget"); return -1; }
    frame += count;
    return count;
}
}
