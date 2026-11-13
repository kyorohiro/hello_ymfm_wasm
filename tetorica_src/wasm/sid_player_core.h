// SPDX-License-Identifier: BSD-3-Clause
// Bounded PSID init/play host, not a complete C64 machine. The two included
// unchanged/pinned chip components retain their zlib licenses.
#pragma once
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#define CHIPS_IMPL
#include "../../third_party/chips-m6502/upstream/m6502.h"
#include "../../third_party/chips-m6581/m6581.h"

namespace tetorica {
class SidPlayerCore {
public:
    static constexpr unsigned clockHz = 985248, frameCycles = 19656;
    static constexpr unsigned initBudget = 100000, playBudget = 16000;
    static constexpr unsigned outputCapacity = 4096, queueCapacity = 16384, traceCapacity = 4096;
    enum State : unsigned { Empty = 0, Running = 1, Stopped = 2, Error = 3 };
    enum ErrorCode : unsigned { None = 0, InvalidArguments, InvalidProgramRange,
        UnsupportedIo, MissingRom, SubroutineTimeout, UnsupportedExecution,
        AudioQueueFull, NotLoaded, UnsupportedBanking, CpuJam };
    struct TraceEntry { uint32_t cycleLow, cycleHigh, reg, value; };

    explicit SidPlayerCore(unsigned sampleRate) : sampleRate_(sampleRate) { resetSound(); }
    uint8_t* input() { return input_.data(); }
    float* output() { return output_.data(); }
    bool load(unsigned length, unsigned loadAddress, unsigned initAddress, unsigned playAddress, unsigned subtune) {
        if (length == 0 || length > input_.size() || subtune > 255) return fail(InvalidArguments);
        const uint64_t end = uint64_t(loadAddress) + length;
        if (loadAddress < 0x0800 || end > 0xd000 || initAddress < loadAddress || initAddress >= end
            || playAddress < loadAddress || playAddress >= end) return fail(InvalidProgramRange);
        resetSound(); ram_.fill(0); ram_[0] = 0x2f; ram_[1] = 0x37; ram_[0x02a6] = 1;
        std::memcpy(ram_.data() + loadAddress, input_.data(), length);
        cycles_ = 0; initCycles_ = playCalls_ = skippedVbis_ = 0;
        traceCount_ = droppedTrace_ = 0; errorCode_ = None; errorAddress_ = 0; timeoutDuringInit_ = false;
        initAddress_ = initAddress; playAddress_ = playAddress;
        m6502_desc_t desc{}; cpuPins_ = m6502_init(&cpu_, &desc);
        state_ = Running; initializing_ = true;
        startCall(initAddress_, static_cast<uint8_t>(subtune));
        while (cpuActive_ && state_ == Running) tick();
        if (state_ != Running) return false;
        initCycles_ = static_cast<unsigned>(cycles_); initializing_ = false;
        skippedVbis_ = initCycles_ / frameCycles;
        nextPlayCycle_ = uint64_t(skippedVbis_ + 1) * frameCycles;
        return true;
    }
    bool render(unsigned frames) {
        output_.fill(0);
        if (frames > outputCapacity) return fail(InvalidArguments);
        if (state_ == Error || state_ == Empty) return false;
        if (state_ == Stopped) return true;
        for (unsigned i = 0; i < frames; ++i) {
            while (!queueCount_ && state_ == Running) tick();
            if (state_ != Running) { output_.fill(0); return false; }
            output_[i] = queue_[queueRead_];
            queueRead_ = (queueRead_ + 1) % queueCapacity; --queueCount_;
        }
        return true;
    }
    void stop() {
        cpuActive_ = false; initializing_ = false;
        resetSound(); output_.fill(0);
        if (state_ != Error) state_ = Stopped;
    }
    State state() const { return state_; }
    ErrorCode errorCode() const { return errorCode_; }
    unsigned errorAddress() const { return errorAddress_; }
    const char* error() const {
        switch (errorCode_) {
        case None: return "";
        case InvalidArguments: return "Invalid PSID player arguments or render size";
        case InvalidProgramRange: return "Program and init/play entry points must be in RAM $0800..$CFFF";
        case UnsupportedIo: return "This PSID accesses unsupported C64 I/O (VIC/CIA/expansion); a full C64 environment is required";
        case MissingRom: return "This PSID accesses a mapped BASIC/KERNAL ROM; ROM calls are not supported";
        case SubroutineTimeout: return timeoutDuringInit_
            ? "PSID initialization subroutine did not return within 100000 cycles"
            : "PSID play subroutine did not return within 16000 cycles";
        case UnsupportedExecution: return "PSID attempted BRK/IRQ, I/O execution or an invalid host return";
        case AudioQueueFull: return "PSID initialization exceeded the bounded audio queue";
        case NotLoaded: return "No PSID program is loaded";
        case UnsupportedBanking: return "This PSID changes 6510 memory banking beyond the supported I/O-visible configuration";
        case CpuJam: return "PSID execution reached a CPU JAM/KIL instruction";
        }
        return "PSID player error";
    }
    uint64_t cycles() const { return cycles_; }
    unsigned initCycles() const { return initCycles_; }
    unsigned playCalls() const { return playCalls_; }
    unsigned skippedVbis() const { return skippedVbis_; }
    unsigned reg(unsigned r) const { return r < 32 ? registers_[r] : 0; }
    // Software front-panel intervention at the current bus boundary. This
    // changes only the SID; neither the CPU nor its clock/audio queue advances.
    bool manualWrite(unsigned r, unsigned value) {
        if (state_ != Running || r > 24 || value > 255) return false;
        uint64_t pins = M6581_CS | r; M6581_SET_DATA(pins, value);
        _m6581_write(&chip_, pins); registers_[r] = static_cast<uint8_t>(value);
        return true;
    }
    unsigned sourceRevision(unsigned r) const { return r < 32 ? sourceRevisions_[r] : 0; }
    unsigned envelope(unsigned v) const { return v < 3 ? chip_.voice[v].env_cur_level & 255 : 0; }
    unsigned phase(unsigned v) const { return v < 3 ? chip_.voice[v].wav_accum : 0; }
    const TraceEntry* trace() const { return trace_.data(); }
    unsigned traceCount() const { return traceCount_; }
    unsigned droppedTrace() const { return droppedTrace_; }
    void clearTrace() { traceCount_ = droppedTrace_ = 0; }
private:
    void resetSound() {
        m6581_desc_t desc{};
        desc.tick_hz = clockHz; desc.sound_hz = sampleRate_; desc.magnitude = 1.f;
        m6581_init(&chip_, &desc); registers_.fill(0); sourceRevisions_.fill(0);
        queueRead_ = queueCount_ = 0;
        previousInput_ = previousOutput_ = 0;
        dcPole_ = std::exp(-2.0 * 3.14159265358979323846 * 12.0 / sampleRate_);
    }
    bool fail(ErrorCode code, unsigned address = 0) {
        if (code == SubroutineTimeout) timeoutDuringInit_ = initializing_;
        errorCode_ = code; errorAddress_ = address; state_ = Error; cpuActive_ = false;
        resetSound(); output_.fill(0); return false;
    }
    void startCall(unsigned entry, uint8_t a) {
        // PSID specifies the bank for EVERY init/play call, independently of
        // what the preceding routine left behind. The current payload subset
        // ends at $CFFF, so these are the only two entry mappings required.
        ram_[1] = entry < 0xa000 ? 0x37 : 0x36;
        // An actual six-cycle JSR uses the normal emulated stack. Its top-level
        // RTS must return to $0203 with the original stack pointer.
        ram_[0x0200] = 0x20; ram_[0x0201] = static_cast<uint8_t>(entry);
        ram_[0x0202] = static_cast<uint8_t>(entry >> 8); ram_[0x0203] = 0xea;
        m6502_set_a(&cpu_, a); m6502_set_x(&cpu_, 0); m6502_set_y(&cpu_, 0);
        m6502_set_s(&cpu_, 0xfd); m6502_set_p(&cpu_, M6502_IF | M6502_XF);
        m6502_set_pc(&cpu_, 0x0200);
        cpuPins_ = M6502_RW | M6502_SYNC;
        M6502_SET_ADDR(cpuPins_, 0x0200); M6502_SET_DATA(cpuPins_, ram_[0x0200]);
        cpuActive_ = true; callCycles_ = 0; instruction_ = 0x20;
    }
    bool isSid(unsigned address) const { return address >= 0xd400 && address <= 0xd7ff; }
    bool discardedVicReadBeforeSidStore(unsigned address) const {
        // Pinned m6502 uses IR++ in its dispatcher. These are precisely the
        // discarded read phases of ordinary STA abs,X / abs,Y / (zp),Y, not
        // an operand read or a general permission to access VIC registers.
        if ((cpuPins_ & (M6502_RW | M6502_SYNC)) != M6502_RW || address < 0xd300 || address > 0xd3ff) return false;
        // VIC sprite-collision mirrors clear latches on read, even when the
        // CPU discards the returned value. This limited host cannot fake that.
        if ((address & 0x3f) == 0x1e || (address & 0x3f) == 0x1f) return false;
        unsigned index;
        switch (cpu_.IR) {
        case (0x9d << 3) | 3: index = cpu_.X; break;
        case (0x99 << 3) | 3: case (0x91 << 3) | 4: index = cpu_.Y; break;
        default: return false;
        }
        const uint16_t target = static_cast<uint16_t>(cpu_.AD + index);
        return isSid(target) && address == ((cpu_.AD & 0xff00) | (target & 0xff));
    }
    bool memoryRead(unsigned address, uint8_t& value) {
        // The following write uses A, never this dummy read's data. Keep the
        // bus cycle and SID clock for a side-effect-free VIC read, without
        // inventing a VIC model. Actual VIC accesses and read-side effects
        // still require a full C64 environment and remain rejected.
        if (discardedVicReadBeforeSidStore(address)) { value = 0xff; return true; }
        if ((address >= 0xa000 && address <= 0xbfff && (ram_[1] & 3) == 3)
            || (address >= 0xe000 && (ram_[1] & 2))) return fail(MissingRom, address);
        if (address >= 0xd000 && address <= 0xdfff) return fail(UnsupportedIo, address);
        value = ram_[address]; return true;
    }
    bool memoryWrite(unsigned address, uint8_t value) {
        if (address >= 0xd000 && address <= 0xdfff) return fail(UnsupportedIo, address);
        // Only the three conventional I/O-visible maps are supported. No
        // character ROM, tape device, or hidden I/O/RAM bank is guessed.
        if ((address == 0 && (value & 7) != 7)
            || (address == 1 && ((value & 4) == 0 || (value & 3) == 0)))
            return fail(UnsupportedBanking, address);
        ram_[address] = value; return true;
    }
    void traceWrite(unsigned reg, uint8_t value) {
        if (traceCount_ < traceCapacity) trace_[traceCount_++] = {
            static_cast<uint32_t>(cycles_), static_cast<uint32_t>(cycles_ >> 32), reg, value};
        else if (droppedTrace_ != std::numeric_limits<unsigned>::max()) ++droppedTrace_;
    }
    void tick() {
        if (state_ != Running) return;
        if (!cpuActive_ && !initializing_ && cycles_ >= nextPlayCycle_) {
            startCall(playAddress_, 0); nextPlayCycle_ += frameCycles;
        }
        uint64_t sidPins = 0;
        bool sidRead = false;
        if (cpuActive_) {
            if (++callCycles_ > (initializing_ ? initBudget : playBudget)) {
                fail(SubroutineTimeout, m6502_pc(&cpu_)); return;
            }
            cpuPins_ = m6502_tick(&cpu_, cpuPins_);
            const unsigned address = M6502_GET_ADDR(cpuPins_);
            if ((cpuPins_ & M6502_SYNC) && address == 0x0203) {
                if (instruction_ != 0x60 || m6502_s(&cpu_) != 0xfd) {
                    fail(UnsupportedExecution, address); return;
                }
                cpuActive_ = false;
                if (!initializing_) ++playCalls_;
                M6502_SET_DATA(cpuPins_, ram_[address]);
            } else if (isSid(address)) {
                if (cpuPins_ & M6502_SYNC) { fail(UnsupportedExecution, address); return; }
                const unsigned reg = address & 31;
                if (cpuPins_ & M6502_RW) { sidPins = M6581_CS | M6581_RW | reg; sidRead = true; }
                else {
                    const uint8_t value = M6502_GET_DATA(cpuPins_);
                    sidPins = M6581_CS | reg; M6581_SET_DATA(sidPins, value);
                    registers_[reg] = value; ++sourceRevisions_[reg]; traceWrite(reg, value);
                }
            } else if (cpuPins_ & M6502_RW) {
                uint8_t value = 0;
                if (!memoryRead(address, value)) return;
                if (cpuPins_ & M6502_SYNC) {
                    if (!value) { fail(UnsupportedExecution, address); return; }
                    switch (value) {
                    case 0x02:case 0x12:case 0x22:case 0x32:case 0x42:case 0x52:
                    case 0x62:case 0x72:case 0x92:case 0xb2:case 0xd2:case 0xf2:
                        fail(CpuJam,address); return;
                    }
                    instruction_ = value;
                }
                M6502_SET_DATA(cpuPins_, value);
            } else if (!memoryWrite(address, M6502_GET_DATA(cpuPins_))) return;
        }
        const uint64_t result = m6581_tick(&chip_, sidPins);
        ++cycles_;
        if (sidRead) M6502_SET_DATA(cpuPins_, M6581_GET_DATA(result));
        if (result & M6581_SAMPLE) {
            if (queueCount_ == queueCapacity) { fail(AudioQueueFull); return; }
            const double input = chip_.sample;
            const double output = input - previousInput_ + dcPole_ * previousOutput_;
            previousInput_ = input; previousOutput_ = output;
            queue_[(queueRead_ + queueCount_) % queueCapacity] = static_cast<float>(output);
            ++queueCount_;
        }
    }
    unsigned sampleRate_;
    m6502_t cpu_{}; uint64_t cpuPins_ = 0;
    m6581_t chip_{};
    std::array<uint8_t, 65536> input_{}, ram_{};
    std::array<uint8_t, 32> registers_{};
    std::array<uint32_t, 32> sourceRevisions_{};
    std::array<float, outputCapacity> output_{};
    std::array<float, queueCapacity> queue_{};
    std::array<TraceEntry, traceCapacity> trace_{};
    State state_ = Empty; ErrorCode errorCode_ = None;
    unsigned errorAddress_ = 0, initAddress_ = 0, playAddress_ = 0;
    uint64_t cycles_ = 0, nextPlayCycle_ = 0;
    unsigned initCycles_ = 0, playCalls_ = 0, skippedVbis_ = 0;
    unsigned callCycles_ = 0, queueRead_ = 0, queueCount_ = 0, traceCount_ = 0, droppedTrace_ = 0;
    uint8_t instruction_ = 0;
    bool initializing_ = false, cpuActive_ = false, timeoutDuringInit_ = false;
    double previousInput_ = 0, previousOutput_ = 0, dcPole_ = 0;
};
}
