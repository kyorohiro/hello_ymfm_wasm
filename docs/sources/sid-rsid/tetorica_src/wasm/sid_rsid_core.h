// SPDX-License-Identifier: BSD-3-Clause
// Original host/shim. Hardware components retain their upstream zlib license.
// No Commodore ROM bytes or GPL player/stub implementation are included.
#pragma once
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <initializer_list>
#include <limits>
#include "../../third_party/chips-c64/upstream/chips/chips_common.h"
#include "../../third_party/chips-m6502/upstream/m6502.h"
#include "../../third_party/chips-c64/upstream/chips/m6526.h"
#include "../../third_party/chips-c64/upstream/chips/m6569.h"
#include "../../third_party/chips-m6581/m6581.h"
#include "../../third_party/chips-c64/upstream/chips/kbd.h"
#include "../../third_party/chips-c64/upstream/chips/mem.h"
#include "../../third_party/chips-c64/upstream/chips/clk.h"
#include "../../third_party/chips-c64/upstream/systems/c1530.h"
#include "../../third_party/chips-c64/upstream/chips/m6522.h"
#include "../../third_party/chips-c64/upstream/systems/c1541.h"
#include "../../third_party/chips-c64/upstream/systems/c64.h"
extern "C" uint64_t tetorica_rsid_machine_tick(c64_t* machine, uint64_t pins);

namespace tetorica {
class SidRsidCore {
public:
    static constexpr unsigned clockHz = 985248, outputCapacity = 4096, queueCapacity = 16384, traceCapacity = 4096;
    static constexpr unsigned preflightCycles = 100000, fullBootCycles = 2000000;
    enum State : unsigned { Empty = 0, Running = 1, Stopped = 2, Error = 3 };
    enum ErrorCode : unsigned { None = 0, InvalidArguments = 1, InvalidProgramRange = 2,
        MissingRom = 4, CpuJam = 6, AudioQueueFull = 7, BasicNeedsRoms = 10,
        InitTimeout = 11, PlayTimeout = 12 };
    struct TraceEntry { uint32_t cycleLow, cycleHigh, reg, value; };
    explicit SidRsidCore(unsigned sampleRate) : sampleRate_(sampleRate) {}
    ~SidRsidCore() { if (machine_.valid) c64_discard(&machine_); }
    uint8_t* input() { return input_.data(); }
    uint8_t* romInput() { return romInput_.data(); }
    float* output() { return output_.data(); }
    bool load(unsigned length, unsigned loadAddress, unsigned initAddress, unsigned subtune, unsigned basic, unsigned useRoms) {
        return loadMode(length,loadAddress,initAddress,0,subtune,basic,useRoms,false);
    }
    bool loadPsid(unsigned length, unsigned loadAddress, unsigned initAddress, unsigned playAddress, unsigned subtune, unsigned useRoms) {
        return loadMode(length,loadAddress,initAddress,playAddress,subtune,0,useRoms,true);
    }
private:
    bool loadMode(unsigned length, unsigned loadAddress, unsigned initAddress, unsigned playAddress, unsigned subtune, unsigned basic, unsigned useRoms, bool psid) {
        if (!length || length > input_.size() || subtune > 255 || basic > 1 || useRoms > 1) return fail(InvalidArguments);
        const uint64_t end = uint64_t(loadAddress) + length;
        if (psid ? (loadAddress < 0x0800 || end > 0xd000 || initAddress < loadAddress || initAddress >= end
            || playAddress < loadAddress || playAddress >= end)
            : (loadAddress < 0x07e8 || end > 65536 || (!basic && (initAddress < loadAddress || initAddress >= end
            || !((initAddress >= 0x07e8 && initAddress < 0xa000) || (initAddress >= 0xc000 && initAddress < 0xd000))))))
            return fail(InvalidProgramRange);
        if (basic && !useRoms) return fail(BasicNeedsRoms);
        if (machine_.valid) c64_discard(&machine_);
        errorCode_ = None; errorAddress_ = 0; state_ = Running;
        cycles_ = bootCycles_ = initCycles_ = initReturnCycle_ = 0;
        irqCount_ = nmiCount_ = readCount_ = writeCount_ = traceCount_ = droppedTrace_ = 0;
        previousInterrupts_ = 0; initReturned_ = initSeen_ = false;
        psid_ = psid; playAddress_ = playAddress; playCalls_ = 0; playPending_ = playActive_ = false;
        useRoms_ = useRoms != 0; basic_ = basic != 0; initAddress_ = initAddress;
        discardAudio_ = useRoms_; clearAudio(); registers_.fill(0);
        if (!useRoms_) prepareShim(initAddress, static_cast<uint8_t>(subtune));
        c64_desc_t desc{};
        desc.audio.sample_rate = sampleRate_; desc.audio.num_samples = 1; desc.audio.volume = 1.0f;
        desc.audio.callback.func = audio; desc.audio.callback.user_data = this;
        desc.roms.chars = {useRoms_ ? romInput_.data() : chars_.data(), 4096};
        desc.roms.basic = {useRoms_ ? romInput_.data() + 4096 : basicRom_.data(), 8192};
        desc.roms.kernal = {useRoms_ ? romInput_.data() + 12288 : kernal_.data(), 8192};
        c64_init(&machine_, &desc);
        if (useRoms_) {
            for (unsigned i = 0; i < fullBootCycles && state_ == Running; ++i) tick();
            if (state_ != Running) return false;
            bootCycles_ = cycles_; discardAudio_ = false; clearAudio();
            machine_.audio.sample_pos = 0;
            traceCount_ = droppedTrace_ = readCount_ = writeCount_ = irqCount_ = nmiCount_ = 0;
            // Load into physical RAM, including RAM under mapped ROM/I/O.
            std::memcpy(machine_.ram + loadAddress, input_.data(), length);
            if (basic_) setRam16(0x2b, loadAddress);
            for (unsigned address : {0x2d, 0x2f, 0x31, 0x33, 0xae}) setRam16(address, static_cast<unsigned>(end) & 65535);
            machine_.ram[0x030c] = static_cast<uint8_t>(subtune);
            machine_.ram[0x030d] = machine_.ram[0x030e] = 0; machine_.ram[0x030f] = M6502_XF;
            if (!psid_) {
                if (basic_) c64_basic_run(&machine_); else c64_basic_syscall(&machine_, static_cast<uint16_t>(initAddress));
            }
        } else {
            // The independently authored reset shim supplies only documented
            // power-on state and IRQ/NMI calling conventions, not a ROM clone.
            std::fill_n(machine_.ram, sizeof(machine_.ram), uint8_t(0));
        }
        if (!useRoms_) {
            std::memcpy(machine_.ram + loadAddress, input_.data(), length);
        }
        if (psid_) preparePsidCaller(initAddress,playAddress,static_cast<uint8_t>(subtune));
        const uint64_t start = cycles_;
        while (cycles_ - start < preflightCycles && state_ == Running) tick();
        initCycles_ = static_cast<unsigned>(cycles_ - start);
        if (psid_ && state_ == Running && !initReturned_) return fail(InitTimeout,initAddress_);
        return state_ == Running;
    }
public:
    bool render(unsigned frames) {
        output_.fill(0);
        if (frames > outputCapacity) return fail(InvalidArguments);
        if (state_ == Error || state_ == Empty) return false;
        if (state_ == Stopped) return true;
        for (unsigned i = 0; i < frames; ++i) {
            while (!queueCount_ && state_ == Running) tick();
            if (state_ != Running) { output_.fill(0); return false; }
            output_[i] = queue_[queueRead_]; queueRead_ = (queueRead_ + 1) % queueCapacity; --queueCount_;
        }
        return true;
    }
    void stop() {
        clearAudio(); output_.fill(0); registers_.fill(0);
        if (machine_.valid) { m6581_reset(&machine_.sid); machine_.audio.sample_pos = 0; }
        if (state_ != Error) state_ = Stopped;
    }
    State state() const { return state_; }
    ErrorCode errorCode() const { return errorCode_; }
    unsigned errorAddress() const { return errorAddress_; }
    const char* error() const {
        switch (errorCode_) {
        case None: return "";
        case InvalidArguments: return "Invalid SID machine host arguments or render size";
        case InvalidProgramRange: return "Invalid SID RAM range or initialization/play entry";
        case MissingRom: return "This SID program reads unimplemented BASIC/KERNAL/character ROM; provide your C64 ROM set";
        case CpuJam: return "SID execution reached a CPU JAM/KIL instruction";
        case AudioQueueFull: return "SID preflight exceeded the bounded audio queue";
        case BasicNeedsRoms: return "RSID BASIC playback requires your character, BASIC and KERNAL ROMs";
        case InitTimeout: return "PSID initialization did not return within 100000 machine cycles";
        case PlayTimeout: return "PSID CIA play routine did not return within 16000 machine cycles";
        }
        return "RSID host error";
    }
    uint64_t cycles() const { return cycles_; }
    uint64_t bootCycles() const { return bootCycles_; }
    unsigned initCycles() const { return initCycles_; }
    bool initReturned() const { return initReturned_; }
    uint64_t initReturnCycle() const { return initReturnCycle_; }
    unsigned irqCount() const { return irqCount_; }
    unsigned nmiCount() const { return nmiCount_; }
    unsigned playCalls() const { return playCalls_; }
    unsigned readCount() const { return readCount_; }
    unsigned writeCount() const { return writeCount_; }
    unsigned pc() const { return machine_.valid ? machine_.cpu.PC : 0; }
    unsigned ramRead(unsigned address) const { return machine_.valid && address < 65536 ? machine_.ram[address] : 0; }
    unsigned reg(unsigned r) const { return r < 32 ? registers_[r] : 0; }
    unsigned envelope(unsigned v) const { return v < 3 ? machine_.sid.voice[v].env_cur_level & 255 : 0; }
    unsigned phase(unsigned v) const { return v < 3 ? machine_.sid.voice[v].wav_accum : 0; }
    const TraceEntry* trace() const { return trace_.data(); }
    unsigned traceCount() const { return traceCount_; }
    unsigned droppedTrace() const { return droppedTrace_; }
    void clearTrace() { traceCount_ = droppedTrace_ = 0; }
private:
    static void increase(unsigned& value) { if (value != std::numeric_limits<unsigned>::max()) ++value; }
    void clearAudio() {
        queueRead_ = queueCount_ = 0; previousInput_ = previousOutput_ = 0;
        dcPole_ = std::exp(-2.0 * 3.14159265358979323846 * 12.0 / sampleRate_);
    }
    bool fail(ErrorCode code, unsigned address = 0) {
        errorCode_ = code; errorAddress_ = address; state_ = Error;
        stop(); return false;
    }
    static void audio(const float* samples, int count, void* user) {
        auto& self = *static_cast<SidRsidCore*>(user);
        if (self.discardAudio_ || self.state_ != Running) return;
        for (int i = 0; i < count; ++i) {
            if (self.queueCount_ == queueCapacity) { self.fail(AudioQueueFull); return; }
            const double input = samples[i], output = input - self.previousInput_ + self.dcPole_ * self.previousOutput_;
            self.previousInput_ = input; self.previousOutput_ = output;
            self.queue_[(self.queueRead_ + self.queueCount_) % queueCapacity] = static_cast<float>(output); ++self.queueCount_;
        }
    }
    void setRam16(unsigned address, unsigned value) {
        machine_.ram[address] = static_cast<uint8_t>(value); machine_.ram[address + 1] = static_cast<uint8_t>(value >> 8);
    }
    void preparePsidCaller(unsigned initAddress, unsigned playAddress, uint8_t subtune) {
        // Firmware boot may have fetched an address equal to the future tune's
        // entry. Only the subsequent loaded PSID invocation counts as init.
        initSeen_ = initReturned_ = false; initReturnCycle_ = 0;
        // This is an original PSID host driver, not a KERNAL replacement. The
        // machine's CIA clocks assert IRQ; no host-side periodic play callback
        // exists. Both ROM-mapped and banked-out IRQ paths enter the same RAM
        // dispatcher, with A/X/Y already saved on the 6502 stack.
        unsigned cursor = 0x0600;
        auto put = [&](std::initializer_list<uint8_t> bytes) { for (auto byte : bytes) machine_.ram[cursor++] = byte; };
        put({0x48,0x8a,0x48,0x98,0x48}); // raw RAM IRQ vector: PHA/TXA/PHA/TYA/PHA
        const unsigned dispatcher = cursor;
        put({0xa5,0x01,0x48,0xa9,static_cast<uint8_t>(playAddress < 0xa000 ? 0x37 : 0x36),0x85,0x01});
        put({0xa9,0,0xaa,0xa8});
        playCallAddress_ = cursor;
        put({0x20,static_cast<uint8_t>(playAddress),static_cast<uint8_t>(playAddress >> 8)});
        playReturnAddress_ = cursor;
        // A play routine may inspect the triggering ICR flags itself. Read to
        // acknowledge only after play, with I/O visible even if it left bank35.
        put({0xa9,0x37,0x85,0x01,0xad,0x0d,0xdc});
        put({0x68,0x85,0x01,0x68,0xa8,0x68,0xaa,0x68,0x40}); // bank, Y, X, A, RTI
        // A benign NMI handler is also in RAM, so a tune may bank KERNAL out.
        cursor = 0x0650;
        put({0x48,0x8a,0x48,0x98,0x48,0xa5,0x01,0x48,0xa9,0x37,0x85,0x01,
            0xad,0x0d,0xdd,0x68,0x85,0x01,0x68,0xa8,0x68,0xaa,0x68,0x40});
        setRam16(0x0314,dispatcher); setRam16(0xfffe,0x0600);
        setRam16(0x0318,0x0650); setRam16(0xfffa,0x0650);
        // PSID init is a subroutine with I set. Its own CIA latch/control/mask
        // changes remain in effect after it returns. The idle loop never calls
        // play itself, and remains executable with any supported ROM bank.
        cursor = 0x0700;
        put({0x78,0xa9,subtune,0xa2,0,0xa0,0,0x20,static_cast<uint8_t>(initAddress),
            static_cast<uint8_t>(initAddress >> 8),0x58,0x4c,0x0b,0x07});
        idleAddress_ = 0x070a;
        // Apply documented PSID host defaults by actual CPU register writes,
        // including after optional firmware boot. The RAM bootstrap is below
        // the minimum PSID payload and does not patch user-supplied ROM bytes.
        cursor = 0x0400;
        auto sta = [&](unsigned address, unsigned value) {
            put({0xa9,static_cast<uint8_t>(value),0x8d,static_cast<uint8_t>(address),static_cast<uint8_t>(address >> 8)});
        };
        put({0x78,0xd8,0xa2,0xff,0x9a});
        sta(1,0x37); sta(0,0x2f); sta(0x02a6,1);
        sta(0xd01a,0); sta(0xd019,0x0f);
        sta(0xdc0e,0); sta(0xdc0f,0); sta(0xdd0e,0); sta(0xdd0f,0);
        sta(0xdc0d,0x7f); sta(0xdd0d,0x7f); put({0xad,0x0d,0xdc,0xad,0x0d,0xdd});
        for (unsigned address : {0xdc06,0xdc07,0xdd04,0xdd05,0xdd06,0xdd07}) sta(address,0xff);
        sta(0xdc04,0x25); sta(0xdc05,0x40); sta(0xdc0d,0x81); sta(0xdc0e,0x11);
        sta(1,initAddress < 0xa000 ? 0x37 : 0x36);
        put({0x4c,0x00,0x07});
        // Documented m6502 prefetch API: begin at the RAM bootstrap without
        // resetting the continuously clocked CIA/VIC/SID hardware after boot.
        m6502_set_p(&machine_.cpu,M6502_IF | M6502_XF);
        m6502_set_pc(&machine_.cpu,0x0400);
        machine_.pins = M6502_SYNC | M6502_RW;
        M6502_SET_ADDR(machine_.pins,0x0400); M6502_SET_DATA(machine_.pins,machine_.ram[0x0400]);
    }
    void emit(unsigned address, std::initializer_list<uint8_t> bytes) {
        for (auto byte : bytes) { kernal_[address - 0xe000] = byte; romAllowed_[address - 0xe000] = 1; ++address; }
        // Real 6502 instructions can prefetch a following byte before a branch.
        for (unsigned i = 0; i < 2 && address < 0x10000; ++i, ++address) {
            kernal_[address - 0xe000] = 0xea; romAllowed_[address - 0xe000] = 1;
        }
    }
    void prepareShim(unsigned initAddress, uint8_t subtune) {
        chars_.fill(0); basicRom_.fill(0x02); kernal_.fill(0x02); romAllowed_.fill(0);
        // Original implementations of the documented IRQ/NMI vector convention.
        emit(0xff48, {0x48,0x8a,0x48,0x98,0x48,0x6c,0x14,0x03});
        emit(0xfe43, {0x78,0x6c,0x18,0x03});
        emit(0xea31, {0xad,0x0d,0xdc,0x4c,0x81,0xea});
        emit(0xea7e, {0x4c,0x31,0xea});
        emit(0xea81, {0x68,0xa8,0x68,0xaa,0x68,0x40});
        emit(0xfebc, {0x4c,0x81,0xea});
        emit(0xe890, {0x48,0x8a,0x48,0x98,0x48,0xad,0x0d,0xdd,0x4c,0x81,0xea});
        emit(0xfffa, {0x43,0xfe,0x00,0xe0,0x48,0xff});
        unsigned cursor = 0xe000;
        auto put = [&](std::initializer_list<uint8_t> b) { for (auto byte : b) { kernal_[cursor - 0xe000] = byte; romAllowed_[cursor++ - 0xe000] = 1; } };
        auto sta = [&](unsigned address, unsigned value) { put({0xa9,static_cast<uint8_t>(value),0x8d,static_cast<uint8_t>(address),static_cast<uint8_t>(address >> 8)}); };
        put({0x78,0xd8,0xa2,0xff,0x9a});
        // Set the output latch before making the bank bits outputs, otherwise
        // the zero reset latch would bank out this boot ROM during STA $00.
        sta(1,0x37); sta(0,0x2f); sta(0x02a6,1);
        sta(0x0314,0x31); sta(0x0315,0xea); sta(0x0318,0x90); sta(0x0319,0xe8);
        sta(0xd011,0x9b); sta(0xd012,0x37); sta(0xd016,8); sta(0xd018,0x14); sta(0xd01a,0);
        sta(0xdc0e,0); sta(0xdc0f,0); sta(0xdd0e,0); sta(0xdd0f,0);
        sta(0xdc0d,0x7f); sta(0xdd0d,0x7f); put({0xad,0x0d,0xdc,0xad,0x0d,0xdd});
        sta(0xdc00,0xff); sta(0xdc01,0xff); sta(0xdc02,0xff); sta(0xdc03,0);
        sta(0xdd00,3); sta(0xdd02,0x3f);
        for (unsigned address : {0xdc04,0xdc05,0xdc06,0xdc07,0xdd04,0xdd05,0xdd06,0xdd07}) sta(address,0xff);
        sta(0xdc04,0x25); sta(0xdc05,0x40); sta(0xdc0d,0x81); sta(0xdc0e,0x11);
        // RSID init may leave KERNAL banked out before RTS. Keep its caller and
        // idle loop below the format's minimum payload address, in physical RAM.
        const std::array<uint8_t,13> caller = {0x58,0xa9,subtune,0xa2,0,0xa0,0,0x20,
            static_cast<uint8_t>(initAddress),static_cast<uint8_t>(initAddress >> 8),0x4c,0x0a,0x07};
        for (unsigned i = 0; i < caller.size(); ++i) sta(0x0700 + i,caller[i]);
        idleAddress_ = 0x070a;
        put({0x4c,0x00,0x07});
        for (unsigned i = 0; i < 2; ++i) put({0xea});
    }
    bool allowedRomRead(unsigned address) const {
        const unsigned port = machine_.cpu_port;
        if ((port & 3) == 3 && address >= 0xa000 && address < 0xc000) return false;
        if ((port & 2) && address >= 0xe000) return romAllowed_[address - 0xe000] != 0;
        if ((port & 3) && !(port & 4) && address >= 0xd000 && address < 0xe000) return false;
        return true;
    }
    void tick() {
        if (state_ != Running) return;
        machine_.pins = tetorica_rsid_machine_tick(&machine_, machine_.pins);
        if (state_ != Running) return;
        const uint64_t pins = machine_.pins;
        const unsigned address = M6502_GET_ADDR(pins);
        if (!useRoms_ && (pins & M6502_RW) && !allowedRomRead(address)) { fail(MissingRom,address); return; }
        if (pins & M6502_SYNC) {
            const uint8_t opcode = M6502_GET_DATA(pins);
            switch (opcode) {
            case 0x02:case 0x12:case 0x22:case 0x32:case 0x42:case 0x52:
            case 0x62:case 0x72:case 0x92:case 0xb2:case 0xd2:case 0xf2: fail(CpuJam,address); return;
            }
            if (address == initAddress_) initSeen_ = true;
            const unsigned returned = useRoms_ && !psid_ ? c64_syscall_return_addr() : idleAddress_;
            if (!basic_ && initSeen_ && !initReturned_ && address == returned) { initReturned_ = true; initReturnCycle_ = cycles_; }
            if (psid_) {
                if (address == playCallAddress_) playPending_ = true;
                else if (playPending_ && address == playAddress_) {
                    playPending_ = false; playActive_ = true; playStartCycle_ = cycles_; increase(playCalls_);
                }
                if (playActive_ && address == playReturnAddress_) playActive_ = false;
            }
        }
        if (playActive_ && cycles_ - playStartCycle_ >= 16000) { fail(PlayTimeout,address); return; }
        const uint64_t interrupts = pins & (M6502_IRQ | M6502_NMI);
        if ((interrupts & M6502_IRQ) && !(previousInterrupts_ & M6502_IRQ)) increase(irqCount_);
        if ((interrupts & M6502_NMI) && !(previousInterrupts_ & M6502_NMI)) increase(nmiCount_);
        previousInterrupts_ = interrupts;
        if (machine_.io_mapped && address >= 0xd400 && address < 0xd800) {
            const unsigned reg = address & 31;
            if (pins & M6502_RW) increase(readCount_);
            else {
                const unsigned value = M6502_GET_DATA(pins); registers_[reg] = static_cast<uint8_t>(value); increase(writeCount_);
                if (traceCount_ < traceCapacity) trace_[traceCount_++] = {static_cast<uint32_t>(cycles_),static_cast<uint32_t>(cycles_ >> 32),reg,value};
                else increase(droppedTrace_);
            }
        }
        ++cycles_;
    }
    unsigned sampleRate_;
    c64_t machine_{};
    std::array<uint8_t,65536> input_{};
    std::array<uint8_t,20480> romInput_{};
    std::array<uint8_t,4096> chars_{};
    std::array<uint8_t,8192> basicRom_{},kernal_{},romAllowed_{};
    std::array<uint8_t,32> registers_{};
    std::array<float,outputCapacity> output_{};
    std::array<float,queueCapacity> queue_{};
    std::array<TraceEntry,traceCapacity> trace_{};
    State state_ = Empty; ErrorCode errorCode_ = None;
    unsigned errorAddress_ = 0,initAddress_ = 0,idleAddress_ = 0,playAddress_ = 0,playCallAddress_ = 0,playReturnAddress_ = 0;
    uint64_t cycles_ = 0,bootCycles_ = 0,initReturnCycle_ = 0,previousInterrupts_ = 0;
    unsigned initCycles_ = 0,irqCount_ = 0,nmiCount_ = 0,readCount_ = 0,writeCount_ = 0,playCalls_ = 0;
    unsigned queueRead_ = 0,queueCount_ = 0,traceCount_ = 0,droppedTrace_ = 0;
    bool useRoms_ = false,basic_ = false,discardAudio_ = false,initReturned_ = false,initSeen_ = false;
    bool psid_ = false,playPending_ = false,playActive_ = false;
    uint64_t playStartCycle_ = 0;
    double previousInput_ = 0,previousOutput_ = 0,dcPole_ = 0;
};
}
