// SPDX-License-Identifier: GPL-2.0-or-later
// External verification executable only. Never linked into Tetorica's runtime.
// See third_party/sid-reference/README.md for pinned upstreams and license boundary.
#include <sidplayfp/sidplayfp.h>
#include <sidplayfp/SidConfig.h>
#include <sidplayfp/SidTune.h>
#include <sidplayfp/SidTuneInfo.h>
#include <sidplayfp/sidbuilder.h>
#include <residfp/residfp.h>
#include "sidemu.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr uint64_t maxCycles = 60000000;
constexpr size_t maxEvents = 1000000;
constexpr size_t maxFileBytes = 124 + 65536 + 2;
constexpr double palC64Clock = 4433618.75 * 4.0 / 18.0;
constexpr const char* playerRevision = "b1e8f1deedf41d343123319237c0d008d72cbea7";
constexpr const char* residRevision = "32c8525418a643eaed8dfafa3d7039e250050cfa";

uint64_t integer(const char* text, uint64_t low, uint64_t high, const char* label) {
    const std::string s(text);
    if (s.empty() || s.find_first_not_of("0123456789") != std::string::npos)
        throw std::runtime_error(std::string(label) + " must be an integer");
    size_t used = 0;
    const uint64_t n = std::stoull(s, &used);
    if (used != s.size() || n < low || n > high)
        throw std::runtime_error(std::string(label) + " is outside the supported range");
    return n;
}
unsigned big16(const std::vector<uint8_t>& b, size_t i) { return b[i] * 256u + b[i + 1]; }
std::vector<uint8_t> inputFile(const char* path, unsigned subtune) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f || f.tellg() < 0 || static_cast<uint64_t>(f.tellg()) > maxFileBytes)
        throw std::runtime_error("PSID input is missing or exceeds 65,662 bytes");
    const auto length = static_cast<size_t>(f.tellg());
    f.seekg(0);
    std::vector<uint8_t> b(length);
    if (length && !f.read(reinterpret_cast<char*>(b.data()), length)) throw std::runtime_error("Cannot read PSID");
    if (length < 125 || std::memcmp(b.data(), "PSID", 4) != 0)
        throw std::runtime_error("Only PSID is supported; RSID and other formats are not supported");
    if (big16(b, 4) != 2 || big16(b, 6) != 124)
        throw std::runtime_error("Only PSID v2 with data offset 124 is supported");
    if (big16(b, 118) != 0x14 || b[122] || b[123])
        throw std::runtime_error("Only explicit PAL / 6581 / single SID PSID is supported");
    if (b[18] || b[19] || b[20] || b[21]) throw std::runtime_error("Only VBI-speed PSID is supported; CIA timing is not supported");
    if (b[120] || b[121]) throw std::runtime_error("Explicit driver relocation is not supported");
    const unsigned songs = big16(b, 14), start = big16(b, 16);
    if (!songs || songs > 256 || !start || start > songs || !subtune || subtune > songs)
        throw std::runtime_error("Invalid PSID song or subtune");
    size_t offset = 124;
    unsigned load = big16(b, 8);
    if (!load) {
        if (length < 127) throw std::runtime_error("Missing embedded load address or program");
        load = b[124] + b[125] * 256u; offset += 2;
    }
    const size_t end = load + length - offset;
    if (load < 0x0800 || end > 0xd000 || end <= load)
        throw std::runtime_error("This verification subset requires program RAM in $0800..$CFFF");
    for (size_t address : {size_t(10), size_t(12)}) {
        const unsigned headerEntry = big16(b, address);
        // PSID init=0 means the effective load address; play=0 is IRQ-only.
        const unsigned entry = address == 10 && !headerEntry ? load : headerEntry;
        if (entry < load || entry >= end)
            throw std::runtime_error("Nonzero init/play addresses inside the program are required; IRQ/ROM entry is unsupported");
    }
    return b;
}

struct Write { uint64_t cycle; unsigned reg, value; };
struct Capture {
    uint64_t duration, lastClock = 0, warmupCycles = 0, engineEndCycle = 0;
    unsigned sampleRate;
    float samplingClockHz = 0;
    uint8_t resetVolume = 0;
    uint8_t requestedResetVolume = 0;
    std::vector<Write> writes, reads;
    std::vector<int16_t> pcm;
};

// Same sampling/clock/read/write order as upstream reSIDfpEmu, with bounded tracing.
// The CPU callback is in PHI2 T. Clocking to PHI1 advances through [T,T+1), then
// the bus write commits: trace T therefore means tick-then-commit, not a free write.
class ReferenceSid final : public libsidplayfp::sidemu {
    reSIDfp::residfp sid;
    Capture& capture;
    size_t bufferCapacity = 0;
public:
    ReferenceSid(sidbuilder* builder, Capture& c) : sidemu(builder), capture(c) { reset(0); }
    ~ReferenceSid() override { delete[] m_buffer; }
    void reset(uint8_t volume) override {
        m_accessClk = 0; m_bufferpos = 0;
        // Verification host initial condition: match Tetorica's all-zero reset.
        // This is not a CPU write; the PSID driver's later volume write is traced.
        sid.reset(); sid.write(0x18, 0);
        capture.requestedResetVolume = volume; capture.resetVolume = 0;
        capture.writes.clear(); capture.reads.clear(); capture.pcm.clear(); capture.lastClock = 0;
    }
    uint64_t phi2() const { return static_cast<uint64_t>(eventScheduler->getTime(libsidplayfp::EVENT_CLOCK_PHI2)); }
    uint64_t phi1() const { return static_cast<uint64_t>(eventScheduler->getTime(libsidplayfp::EVENT_CLOCK_PHI1)); }
    void clock() override {
        const uint64_t target = std::min(phi1(), capture.duration);
        const uint64_t previous = static_cast<uint64_t>(m_accessClk);
        if (target <= previous) return;
        const uint64_t delta = target - previous;
        if (!m_buffer || delta > 20000) throw std::runtime_error("Reference audio clock exceeded its bounded buffer");
        const size_t maximumOutput = static_cast<size_t>(std::ceil(delta * double(capture.sampleRate) / capture.samplingClockHz)) + 8;
        if (size_t(m_bufferpos) + maximumOutput > bufferCapacity)
            throw std::runtime_error("Reference audio buffer overflow rejected");
        const int n = sid.clock(static_cast<unsigned>(delta), m_buffer + m_bufferpos);
        if (n < 0 || size_t(n) > maximumOutput) throw std::runtime_error("Invalid reference sample count");
        capture.pcm.insert(capture.pcm.end(), m_buffer + m_bufferpos, m_buffer + m_bufferpos + n);
        m_bufferpos += n; m_accessClk = target; capture.lastClock = target;
    }
    uint8_t read(uint_least8_t reg) override {
        clock(); const uint8_t value = sid.read(reg);
        const auto cycle = phi2();
        if (cycle < capture.duration) {
            if (capture.reads.size() == maxEvents) throw std::runtime_error("SID read trace limit exceeded");
            capture.reads.push_back({cycle, unsigned(reg), unsigned(value)});
        }
        return value;
    }
    void write(uint_least8_t reg, uint8_t value) override {
        clock(); const auto cycle = phi2();
        if (cycle >= capture.duration) return;
        if (capture.writes.size() == maxEvents) throw std::runtime_error("SID write trace limit exceeded");
        if (!capture.writes.empty() && cycle <= capture.writes.back().cycle)
            throw std::runtime_error("SID writes are not in strictly increasing PHI2 order");
        capture.writes.push_back({cycle, unsigned(reg), unsigned(value)});
        sid.write(reg, value);
    }
    void model(SidConfig::sid_model_t model, bool digiboost) override {
        if (model != SidConfig::MOS6581 || digiboost) throw std::runtime_error("Only 6581 without digiboost is supported");
        sid.setChipModel(reSIDfp::MOS6581); sid.input(0); sid.setCombinedWaveforms(reSIDfp::AVERAGE);
    }
    void sampling(float systemClock, float rate, SidConfig::sampling_method_t method) override {
        if (method != SidConfig::RESAMPLE_INTERPOLATE || rate != capture.sampleRate)
            throw std::runtime_error("Reference sampling configuration mismatch");
        capture.samplingClockHz = systemClock;
        if (!sid.setSamplingParameters(systemClock, reSIDfp::RESAMPLE, rate))
            throw std::runtime_error("Reference resampler rejected sample rate");
        delete[] m_buffer;
        bufferCapacity = static_cast<size_t>(std::ceil(rate * .02f)) + 64;
        m_buffer = new short[bufferCapacity]; m_bufferpos = 0;
    }
};

class ReferenceBuilder final : public sidbuilder {
    Capture& capture;
public:
    ReferenceSid* device = nullptr;
    explicit ReferenceBuilder(Capture& c) : sidbuilder("Tetorica external reference"), capture(c) {}
    ~ReferenceBuilder() override { remove(); }
    libsidplayfp::sidemu* create() override {
        if (!sidobjs.empty()) throw std::runtime_error("Multiple SID devices are unsupported");
        device = new ReferenceSid(this, capture); return device;
    }
    const char* getCredits() const override { return "External GPL-2.0-or-later libsidplayfp/libresidfp verification adapter"; }
};

void events(std::ostream& out, const std::vector<Write>& list) {
    out << '[';
    for (size_t i = 0; i < list.size(); ++i) {
        if (i) out << ',';
        out << "{\"cycle\":" << list[i].cycle << ",\"register\":" << list[i].reg << ",\"value\":" << list[i].value << '}';
    }
    out << ']';
}
void pcmFile(const char* path, const std::vector<int16_t>& pcm) {
    static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559, "IEEE float32 is required");
    std::ofstream out(path, std::ios::binary);
    if (!out) throw std::runtime_error("Cannot open PCM output");
    for (auto sample : pcm) {
        const float f = sample / 32768.f;
        uint32_t bits; std::memcpy(&bits, &f, 4);
        const char bytes[] = {char(bits), char(bits >> 8), char(bits >> 16), char(bits >> 24)};
        out.write(bytes, 4);
    }
    if (!out) throw std::runtime_error("Cannot write PCM output");
}
}

int main(int argc, char** argv) {
    try {
        if (argc != 7 && argc != 8) throw std::runtime_error("Usage: sid-player-reference INPUT TRACE_JSON PCM_F32LE DURATION_CYCLES SAMPLE_RATE SUBTUNE [PLAY_EVENT_CHUNK]");
        const auto duration = integer(argv[4], 100000, maxCycles, "durationCycles");
        const auto rate = static_cast<unsigned>(integer(argv[5], 8000, 96000, "sampleRate"));
        const auto song = static_cast<unsigned>(integer(argv[6], 1, 256, "subtune"));
        const auto chunk = static_cast<unsigned>(argc == 8 ? integer(argv[7], 1, 4096, "play event chunk") : 4096);
        const auto bytes = inputFile(argv[1], song);
        Capture capture{duration, 0, 0, 0, rate};
        ReferenceBuilder builder(capture);
        sidplayfp player;
        player.setRoms(nullptr, nullptr, nullptr); // Upstream's GPL Kernal stub; no Commodore ROM image.
        SidConfig cfg = player.config();
        cfg.defaultC64Model = SidConfig::PAL; cfg.forceC64Model = true;
        cfg.defaultSidModel = SidConfig::MOS6581; cfg.forceSidModel = true;
        cfg.frequency = rate; cfg.powerOnDelay = 0; cfg.sidEmulation = &builder;
        cfg.samplingMethod = SidConfig::RESAMPLE_INTERPOLATE;
        cfg.secondSidAddress = 0; cfg.thirdSidAddress = 0; cfg.digiBoost = false;
        if (!player.config(cfg)) throw std::runtime_error(player.error());
        SidTune tune(bytes.data(), static_cast<uint_least32_t>(bytes.size()));
        if (!tune.getStatus()) throw std::runtime_error(tune.statusString());
        tune.selectSong(song);
        if (!player.load(&tune)) throw std::runtime_error(player.error());
        if (player.installedSIDs() != 1 || !builder.device) throw std::runtime_error("Expected one SID");
        capture.warmupCycles = builder.device->phi1();
        // Capture includes the power-on cycles normally discarded by libsidplayfp.
        // Limiting SID clocking (not its PCM vector) gives an exact absolute endpoint
        // even if the last scheduler-event batch runs slightly beyond the endpoint.
        while (builder.device->phi1() < duration) {
            if (player.play(chunk) < 0) throw std::runtime_error(player.error());
        }
        builder.device->clock(); capture.engineEndCycle = builder.device->phi1();
        if (capture.lastClock != duration) throw std::runtime_error("Reference did not reach requested cycle endpoint");
        if (capture.writes.empty()) throw std::runtime_error("Program produced no SID writes within the requested interval");
        // Report the unchanged upstream RESAMPLE period quantization separately
        // from requested sample rate; do not crop or resample its actual output.
        const double half = rate > 44000 ? 20000.0 : rate * .45;
        const double intermediate = 2 * half + std::sqrt(2 * half * capture.samplingClockHz * (rate - 2 * half) / rate);
        const int period1 = static_cast<int>(capture.samplingClockHz / intermediate * 1024);
        const int period2 = static_cast<int>(intermediate / rate * 1024);
        const double effectiveRate = capture.samplingClockHz * 1048576.0 / (double(period1) * period2);
        pcmFile(argv[3], capture.pcm);
        std::ofstream out(argv[2]);
        if (!out) throw std::runtime_error("Cannot open trace output");
        out << std::setprecision(17)
            << "{\"format\":\"tetorica-sid-trace\",\"version\":1,\"clockHz\":985248,\"model\":\"6581\","
            << "\"cyclePhase\":\"phi2\",\"writeTiming\":\"tick-then-commit\",\"durationCycles\":" << duration
            << ",\"sampleRate\":" << rate << ",\"engine\":{\"name\":\"libsidplayfp\",\"version\":\"3.1.2\",\"revision\":\"" << playerRevision
            << "\",\"sidEngine\":\"libresidfp\",\"sidVersion\":\"1.2.3+serial-table-init\",\"sidOriginalVersion\":\"1.2.3\",\"sidRevision\":\"" << residRevision
            << "\",\"referencePatch\":\"libresidfp-1.2.3-serial-table-init\",\"referencePatchSha256\":\"2ee576ae0030e5b9fc007d4d2fc62eeb1a8982be56e6756efd7aa58bc69e074c"
            << "\",\"license\":\"GPL-2.0-or-later\",\"c64ClockHz\":" << palC64Clock
            << ",\"samplingClockHz\":" << capture.samplingClockHz
            << ",\"sampling\":\"RESAMPLE\",\"resamplerPeriodScale\":1024,\"resamplerPeriods\":[" << period1 << ',' << period2
            << "],\"effectiveSampleRateHz\":" << effectiveRate
            << ",\"powerOnDelay\":0,\"roms\":\"upstream-kernal-stub-only\",\"hostInitialRegisters\":\"all-zero\"},"
            << "\"input\":{\"subtune\":" << song << ",\"bytes\":" << bytes.size() << "},"
            << "\"capture\":{\"warmupCycles\":" << capture.warmupCycles
            << ",\"engineEndCycle\":" << capture.engineEndCycle << ",\"endCycle\":" << capture.lastClock
            << ",\"referenceResetVolume\":" << unsigned(capture.resetVolume)
            << ",\"requestedResetVolume\":" << unsigned(capture.requestedResetVolume)
            << ",\"sampleCount\":" << capture.pcm.size() << ",\"pcmFormat\":\"f32le-mono\",\"normalization\":\"int16/32768\","
            << "\"readsAreReferenceDependent\":true},\"writes\":";
        events(out, capture.writes); out << ",\"reads\":"; events(out, capture.reads); out << "}\n";
        if (!out) throw std::runtime_error("Cannot write trace output");
        std::cout << "{\"passed\":true,\"durationCycles\":" << duration << ",\"sampleRate\":" << rate
                  << ",\"sampleCount\":" << capture.pcm.size() << ",\"writes\":" << capture.writes.size()
                  << ",\"reads\":" << capture.reads.size() << "}\n";
    } catch (const std::exception& error) {
        std::cerr << "SID reference: " << error.what() << '\n'; return 1;
    }
}
