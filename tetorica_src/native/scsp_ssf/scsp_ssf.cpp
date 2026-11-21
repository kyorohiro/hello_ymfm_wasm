// SPDX-License-Identifier: BSD-3-Clause
#include "scsp_ssf.h"
#include "m68kops.h"
#include "scsp_instrument.h"

#include <array>
#include <cstdlib>
#include <memory>
#include <new>

namespace {
constexpr uint32_t kRamBytes = 512 * 1024;
constexpr uint32_t kRegisterBase = 0x100000;
constexpr uint32_t kRegisterBytes = 0x1000;
constexpr uint32_t kAddressMask = 0x00ffffff;
constexpr uint32_t kNoFault = UINT32_MAX;
// Nominal Saturn sound clock of 11.2896 MHz at 44.1 kHz output.
constexpr int kCpuCyclesPerFrame = 256;

constexpr uint32_t kMidiInput = 0x404;
constexpr uint16_t kMidiEmpty = (1u << 11) | (1u << 8); // MOEMP and MIEMP
constexpr uint32_t kDspGap = 0x7c0;
constexpr uint32_t kDspProgram = 0x800;
constexpr uint32_t kDspWorkStart = 0xc00;
constexpr uint32_t kDspWorkEnd = 0xee4;

// SCSP common registers at $100418–$10042e. These are part of the sound
// board; the shared PCM/DSP instrument API does not execute interrupt logic.
constexpr uint32_t kTimerA = 0x418;
constexpr uint32_t kTimerC = 0x41c;
constexpr uint32_t kSoundEnable = 0x41e;
constexpr uint32_t kSoundPending = 0x420;
constexpr uint32_t kSoundReset = 0x422;
constexpr uint32_t kSoundLevel0 = 0x424;
constexpr uint32_t kSoundLevel2 = 0x428;
constexpr uint32_t kMainEnable = 0x42a;
constexpr uint32_t kMainPending = 0x42c;
constexpr uint32_t kMainReset = 0x42e;
constexpr uint16_t kManualIrq = 1u << 5;
constexpr uint16_t kTimerAIrq = 1u << 6;
constexpr uint16_t kSampleIrq = 1u << 10;
constexpr uint16_t kIrqMask = 0x07ff;

uint16_t mergeWord(uint16_t previous, uint16_t value, uint16_t mask) {
    return (previous & ~mask) | (value & mask);
}

struct ScspTimer {
    uint16_t read() const { return (prescaler << 8) | count; }

    void write(uint16_t value, uint16_t mask) {
        const uint16_t next = mergeWord(read(), value, mask);
        prescaler = (next >> 8) & 7;
        count = uint8_t(next);
        if ((mask & 0xff) || remaining != 0)
            remaining = count == 0xff ? 0 : 1u << prescaler;
    }

    bool advanceSample() {
        if (remaining == 0 || --remaining != 0)
            return false;
        if (++count == 0xff)
            return true;
        remaining = 1u << prescaler;
        return false;
    }

    uint8_t prescaler = 0;
    uint8_t count = 0;
    unsigned remaining = 0;
};

class ScspInterrupts {
public:
    static bool owns(uint32_t offset) { return offset >= kTimerA && offset <= kMainReset; }

    uint16_t read(uint32_t offset) const {
        if (offset <= kTimerC)
            return timers[(offset - kTimerA) / 2].read();
        if (offset >= kSoundLevel0 && offset <= kSoundLevel2)
            return soundLevels[(offset - kSoundLevel0) / 2];
        switch (offset) {
        case kSoundEnable: return soundEnabled;
        case kSoundPending: return soundPending;
        case kMainEnable: return mainEnabled;
        case kMainPending: return mainPending;
        default: return 0; // Writing one to a reset register clears that flag.
        }
    }

    void write(uint32_t offset, uint16_t value, uint16_t mask) {
        if (offset <= kTimerC) {
            timers[(offset - kTimerA) / 2].write(value, mask);
            return;
        }
        if (offset >= kSoundLevel0 && offset <= kSoundLevel2) {
            auto &level = soundLevels[(offset - kSoundLevel0) / 2];
            level = uint8_t(mergeWord(level, value, mask));
            return;
        }
        switch (offset) {
        case kSoundEnable: soundEnabled = mergeWord(soundEnabled, value, mask & kIrqMask); break;
        case kSoundPending: soundPending |= value & mask & kManualIrq; break;
        case kSoundReset: soundPending &= ~(value & mask); break;
        case kMainEnable: mainEnabled = mergeWord(mainEnabled, value, mask & kIrqMask); break;
        case kMainPending: mainPending |= value & mask & kManualIrq; break;
        case kMainReset: mainPending &= ~(value & mask); break;
        }
    }

    void advanceSample() {
        uint16_t events = kSampleIrq;
        for (unsigned index = 0; index < timers.size(); ++index) {
            if (timers[index].advanceSample())
                events |= kTimerAIrq << index;
        }
        soundPending |= events;
        mainPending |= events;
    }

    unsigned soundLevel() const {
        const uint16_t requests = soundPending & soundEnabled;
        unsigned highest = 0;
        for (unsigned source = 5; source <= 10; ++source) {
            if (!(requests & (1u << source)))
                continue;
            // Timer B, Timer C and sample IRQ use the same SCILV column.
            const unsigned column = source < 7 ? source : 7;
            unsigned level = 0;
            for (unsigned bit = 0; bit < soundLevels.size(); ++bit)
                level |= ((soundLevels[bit] >> column) & 1u) << bit;
            if (level > highest)
                highest = level;
        }
        return highest;
    }

private:
    std::array<ScspTimer, 3> timers{};
    std::array<uint8_t, 3> soundLevels{};
    uint16_t soundEnabled = 0, soundPending = 0;
    // Drivers can read and clear these latches. The standalone board has no SH-2.
    uint16_t mainEnabled = 0, mainPending = 0;
};

class SoundBoard {
public:
    ~SoundBoard() { scsp_destroy(chip); }

    bool start(const uint8_t *ram) {
        if (!chip || !scsp_load_ram(chip, 0, ram, kRamBytes))
            return false;
        cpu.SetUserData(this);
        cpu.m68k_set_cpu_type(M68K_CPU_TYPE_68000);
        cpu.m68k_pulse_reset();
        const uint32_t pc = cpu.m68k_get_reg(M68K_REG_PC) & kAddressMask;
        const uint32_t stack = cpu.m68k_get_reg(M68K_REG_SP);
        if (pc >= kRamBytes || ((pc | stack) & 1))
            return false;

        // The pinned core returns reset clocks separately when the requested
        // slice ends at reset. Charge them before running the first instruction.
        const int resetCycles = cpu.m68ki_cpu.reset_cycles;
        if (resetCycles > 0)
            cyclesAhead = cpu.Execute(resetCycles);
        return true;
    }

    bool render(float *left, float *right, uint32_t frames) {
        if (fault != kNoFault)
            return false;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            // An instruction can run past the slice. Carry those clocks into
            // the next sample, including when the caller changes block sizes.
            cyclesAhead -= kCpuCyclesPerFrame;
            if (cyclesAhead < 0) {
                updateSoundIrq();
                cyclesAhead += cpu.Execute(-cyclesAhead);
            }
            if (fault != kNoFault || !scsp_render(chip, left + frame, right + frame, 1))
                return false;
            interrupts.advanceSample();
        }
        return true;
    }

    uint16_t read(uint32_t address, bool byteAccess) {
        if (fault != kNoFault)
            return UINT16_MAX;
        address &= kAddressMask;
        if ((address & 1) && !byteAccess)
            return reportFault(address);
        if (address < kRamBytes) {
            uint8_t bytes[2]{};
            scsp_read_ram(chip, address, bytes, byteAccess ? 1 : 2);
            return byteAccess ? bytes[0] : (uint16_t(bytes[0]) << 8) | bytes[1];
        }
        if (!isRegister(address))
            return reportFault(address);
        const uint32_t offset = (address - kRegisterBase) & ~1u;
        const uint32_t value = readRegister(offset);
        if (value == UINT32_MAX)
            return reportFault(address);
        if (!byteAccess)
            return uint16_t(value);
        return uint8_t(value >> ((address & 1) ? 0 : 8));
    }

    void write(uint32_t address, uint16_t value, bool byteAccess) {
        if (fault != kNoFault)
            return;
        address &= kAddressMask;
        if (!(address & 1) || byteAccess) {
            if (address < kRamBytes) {
                const uint8_t bytes[] = {uint8_t(byteAccess ? value : value >> 8), uint8_t(value)};
                scsp_load_ram(chip, address, bytes, byteAccess ? 1 : 2);
                return;
            }
            if (isRegister(address)) {
                const uint32_t offset = (address - kRegisterBase) & ~1u;
                const unsigned shift = byteAccess && !(address & 1) ? 8 : 0;
                const uint16_t mask = byteAccess ? 0xffu << shift : 0xffff;
                const uint16_t word = value << shift;
                if (ScspInterrupts::owns(offset)) {
                    interrupts.write(offset, word, mask);
                    updateSoundIrq();
                    return;
                }
                // The unused write range following MADRS does not alias MADRS.
                if (offset >= kDspGap && offset < kDspProgram)
                    return;
                // Some drivers clear the DSP workspace at boot. Admit the
                // operation only if every addressed bit is already zero.
                if (offset >= kDspWorkStart && offset < kDspWorkEnd &&
                    (word & mask) == 0 && (scsp_read(chip, offset) & mask) == 0)
                    return;
                if (scsp_write(chip, offset, word, mask))
                    return;
            }
        }
        reportFault(address);
    }

    uint32_t faultAddress() const { return fault; }

private:
    static bool isRegister(uint32_t address) {
        return address >= kRegisterBase && address < kRegisterBase + kRegisterBytes;
    }

    uint32_t readRegister(uint32_t offset) {
        if (ScspInterrupts::owns(offset))
            return interrupts.read(offset);
        if (offset == kMidiInput)
            return kMidiEmpty; // No external MIDI device is attached.
        return scsp_read(chip, offset);
    }

    void updateSoundIrq() {
        const unsigned level = interrupts.soundLevel();
        // The pinned core clears IPL internally on autovector. Restore the
        // device level for the next CPU slice. A held level 7 is not a new edge.
        if (level == 7 && lastSoundLevel == 7)
            cpu.m68ki_cpu.int_level = 7u << 8;
        else
            cpu.m68k_set_irq(level);
        lastSoundLevel = level;
    }

    uint16_t reportFault(uint32_t address) {
        fault = address;
        cpu.m68k_end_timeslice();
        return UINT16_MAX;
    }

    // CPU accesses, sample fetches and DSP all use this chip's sound RAM.
    void *chip = scsp_create();
    M68k cpu;
    ScspInterrupts interrupts;
    int cyclesAhead = 0;
    unsigned lastSoundLevel = 0;
    uint32_t fault = kNoFault;
};
}

// These hooks link only into the dedicated SSF renderer. The Atari ST
// player uses its own machine and bus hooks for the same pinned CPU sources.
void *AtariAudioMalloc(size_t size) { return std::malloc(size); }
void AtariAudioFree(void *pointer) { std::free(pointer); }

unsigned int M68k_Read8(void *user, unsigned int address) {
    return uint8_t(static_cast<SoundBoard *>(user)->read(address, true));
}
unsigned int M68k_Read16(void *user, unsigned int address) {
    return static_cast<SoundBoard *>(user)->read(address, false);
}
unsigned int M68k_Read32(void *user, unsigned int address) {
    const uint32_t high = M68k_Read16(user, address);
    return (high << 16) | M68k_Read16(user, address + 2);
}
void M68k_Write8(void *user, unsigned int address, unsigned int value) {
    static_cast<SoundBoard *>(user)->write(address, uint8_t(value), true);
}
void M68k_Write16(void *user, unsigned int address, unsigned int value) {
    static_cast<SoundBoard *>(user)->write(address, uint16_t(value), false);
}
void M68k_Write32(void *user, unsigned int address, unsigned int value) {
    M68k_Write16(user, address, value >> 16);
    M68k_Write16(user, address + 2, value);
}

// Processor RESET does not reset the Saturn sound board. Leave TRAP and
// illegal-instruction dispatch to the CPU's normal exception vectors.
void M68k_Reset_Callback(void *) {}
int M68k_TrapN_Callback(void *, int) { return 0; }
int M68k_Illegal_Callback(void *, int) { return 0; }

void *scsp_ssf_create(const uint8_t *ram, uint32_t size) {
    if (!ram || size != kRamBytes || !m68kTablesValid())
        return nullptr;
    std::unique_ptr<SoundBoard> board(new (std::nothrow) SoundBoard);
    return board && board->start(ram) ? board.release() : nullptr;
}

void scsp_ssf_destroy(void *handle) { delete static_cast<SoundBoard *>(handle); }

int scsp_ssf_render(void *handle, float *left, float *right, uint32_t frames) {
    if (!handle || frames > 1048576 || (frames && (!left || !right)))
        return 0;
    const uintptr_t l = reinterpret_cast<uintptr_t>(left), r = reinterpret_cast<uintptr_t>(right);
    const uintptr_t distance = l < r ? r - l : l - r;
    if (distance < uintptr_t(frames) * sizeof(float))
        return 0;
    return static_cast<SoundBoard *>(handle)->render(left, right, frames);
}

uint32_t scsp_ssf_fault_address(const void *handle) {
    return handle ? static_cast<const SoundBoard *>(handle)->faultAddress() : kNoFault;
}
