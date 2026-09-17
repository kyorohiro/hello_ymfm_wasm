// license:BSD-3-Clause
// copyright-holders:Barry Rodewald
#pragma once
#include <cstdint>
class Oki6258 {
public:
 Oki6258(uint32_t clock,uint8_t flags,uint32_t rate);
 void reset();void write(uint8_t reg,uint8_t value);void generate(float*,float*,uint32_t);
private:
 int16_t clock_adpcm(uint8_t nibble);
 uint32_t initial_clock,clock,clock_buffer,rate;uint8_t initial_flags,data,shift,pan;
 int divider,m_output_bits,m_signal,m_step;bool playing;double phase;float last;
 // Bytes written to the data register queue here; generate() pulls a new byte
 // (and its two nibbles) only once the previous byte is fully consumed. This
 // absorbs the +/-1 tick jitter between the caller's byte-feed timing and the
 // chip's own nibble clock instead of losing/duplicating nibbles.
 static const int kFifoSize = 8;
 uint8_t fifo[kFifoSize]; int fifoHead,fifoTail,fifoCount,nibblesLeft;
};
