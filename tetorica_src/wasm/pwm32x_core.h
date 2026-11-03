// license:BSD-3-Clause
// copyright-holders:David Haywood
// FIFO, routing and timer behavior adapted from MAME mega32x.cpp.
// This C++ port preserves web/pwm32x.js host PCM semantics.
// See third_party/mame-32x-pwm/README.md for provenance and differences.
#ifndef TETORICA_PWM32X_CORE_H
#define TETORICA_PWM32X_CORE_H

#include <algorithm>
#include <array>
#include <cstdint>

namespace tetorica {
namespace pwm32x {

constexpr double DEFAULT_CLOCK = 23011361.0;

struct Fifo {
  std::array<std::uint16_t, 3> values{};
  std::uint32_t size = 0;

  void push(std::uint16_t value) {
    if (size == 3) {
      values[0] = values[1];
      values[1] = values[2];
      size = 2;
    }
    values[size++] = value;
  }
  std::uint16_t pop() {
    const auto value = values[0];
    for (std::uint32_t i = 1; i < size; ++i) values[i - 1] = values[i];
    --size;
    return value;
  }
  std::uint32_t flags() const { return size == 0 ? 0x4000 : size == 3 ? 0x8000 : 0; }
};

// Configuration and mute deliberately live outside State: legacy saveState()
// saves the chip/timer, while gain/clock/outputMode/mute remain current.
struct State {
  std::uint32_t control = 0;
  std::uint32_t cycle = 0;
  std::uint32_t cycle_register = 0;
  Fifo left_fifo{};
  Fifo right_fifo{};
  std::uint32_t left = 0;
  std::uint32_t right = 0;
  bool left_valid = false;
  bool right_valid = false;
  std::uint32_t timer_tick = 0;
  double interrupt_count = 0;
  double until_tick = 0;
};

class Core {
 public:
  explicit Core(double clock = DEFAULT_CLOCK, std::uint32_t rate = 48000,
                double gain = .4, bool duty = false)
      : clock_(clock), rate_(rate), gain_(gain), duty_(duty) {}

  void reset() { state_ = State{}; }
  double clock() const { return clock_; }
  std::uint32_t rate() const { return rate_; }
  double gain() const { return gain_; }
  bool output_mode() const { return duty_; }
  bool muted() const { return muted_; }
  void set_clock(double clock) { clock_ = clock; }
  void set_rate(std::uint32_t rate) { rate_ = rate; }
  void set_gain(double gain) { gain_ = gain; }
  void set_output_mode(bool duty) { duty_ = duty; }
  void set_muted(bool muted) { muted_ = muted; }
  const State& state() const { return state_; }
  bool load_state(const State& state) {
    if (state.left_fifo.size > 3 || state.right_fifo.size > 3) return false;
    state_ = state;
    return true;
  }
  bool active() const { return state_.cycle != 1 && (state_.control & 15) != 0; }
  void configure_timer() {
    if (!state_.cycle) state_.cycle = 4095;
    if (active()) {
      state_.timer_tick = 0;
      state_.left_fifo = Fifo{};
      state_.right_fifo = Fifo{};
      state_.until_tick = state_.cycle - 1;
    }
  }
  void write(std::uint32_t reg, std::uint32_t value) {
    if (reg == 0) {
      state_.control = value & 0xffff;
      configure_timer();
    } else if (reg == 1) {
      state_.cycle_register = state_.cycle = value & 4095;
      configure_timer();
    } else {
      if (reg == 2 || reg == 4) state_.left_fifo.push(value & 0xffff);
      if (reg == 3 || reg == 4) state_.right_fifo.push(value & 0xffff);
    }
  }
  std::uint32_t read(std::uint32_t reg) const {
    if (reg == 0) return state_.control;
    if (reg == 1) return state_.cycle_register;
    if (reg == 2) return state_.left_fifo.flags();
    if (reg == 3) return state_.right_fifo.flags();
    if (reg == 4) return state_.left_fifo.flags() & state_.right_fifo.flags();
    return 0xffff;
  }
  void tick() {
    if (state_.left_fifo.size) {
      const auto value = state_.left_fifo.pop();
      const auto mode = state_.control & 3;
      if (mode == 1) { state_.left = value; state_.left_valid = true; }
      else if (mode == 2) { state_.right = value; state_.right_valid = true; }
    }
    if (state_.right_fifo.size) {
      const auto value = state_.right_fifo.pop();
      const auto mode = (state_.control >> 2) & 3;
      if (mode == 1) { state_.right = value; state_.right_valid = true; }
      else if (mode == 2) { state_.left = value; state_.left_valid = true; }
    }
    ++state_.timer_tick;
    const auto cadence = (state_.control >> 8) & 15;
    if (state_.timer_tick == (cadence ? cadence : 16)) {
      state_.timer_tick = 0;
      ++state_.interrupt_count;
    }
  }
  void output(double& left, double& right) const {
    const double scale = duty_ ? (state_.cycle ? state_.cycle : 4095) / 2.0 : 2048;
    left = muted_ || !state_.left_valid ? 0 : ((state_.left & 4095) / scale - 1) * gain_;
    right = muted_ || !state_.right_valid ? 0 : ((state_.right & 4095) / scale - 1) * gain_;
  }
  void sample(float& left, float& right) {
    const double cycles_per_frame = clock_ / rate_;
    double remaining = cycles_per_frame, l = 0, r = 0;
    while (remaining > 0) {
      const double duration = active() ? std::min(remaining, state_.until_tick) : remaining;
      double a, b;
      output(a, b);
      l += a * duration;
      r += b * duration;
      remaining -= duration;
      if (active()) {
        state_.until_tick -= duration;
        if (state_.until_tick <= 0) { tick(); state_.until_tick = state_.cycle - 1; }
      }
    }
    left = static_cast<float>(l / cycles_per_frame);
    right = static_cast<float>(r / cycles_per_frame);
  }
  void render(float* left, float* right, std::uint32_t frames) {
    for (std::uint32_t i = 0; i < frames; ++i) sample(left[i], right[i]);
  }

 private:
  double clock_;
  std::uint32_t rate_;
  double gain_;
  bool duty_;
  bool muted_ = false;
  State state_{};
};

}  // namespace pwm32x
}  // namespace tetorica
#endif
