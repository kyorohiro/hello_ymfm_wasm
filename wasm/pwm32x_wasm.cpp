// license:BSD-3-Clause
#include "pwm32x_core.h"
#include <cmath>
#include <cstring>
#include <new>

using tetorica::pwm32x::Core;
using tetorica::pwm32x::State;

extern "C" {
Core* pwm32x_create(double clock, std::uint32_t rate, double gain, std::uint32_t duty) {
  if (!std::isfinite(clock) || clock <= 0 || clock > 100000000 ||
      !rate || rate > 1000000 || !std::isfinite(gain) || gain < 0 || gain > 4 || duty > 1) return nullptr;
  return new (std::nothrow) Core(clock, rate, gain, duty != 0);
}
void pwm32x_destroy(Core* p) { delete p; }
void pwm32x_reset(Core* p) { p->reset(); }
void pwm32x_write(Core* p, std::uint32_t reg, std::uint32_t value) { p->write(reg, value); }
std::uint32_t pwm32x_read(Core* p, std::uint32_t reg) { return p->read(reg); }
void pwm32x_generate(Core* p, float* l, float* r, std::uint32_t frames) { p->render(l, r, frames); }
void pwm32x_set_clock(Core* p, double value) { p->set_clock(value); }
void pwm32x_set_gain(Core* p, double value) { p->set_gain(value); }
void pwm32x_set_output_mode(Core* p, std::uint32_t value) { p->set_output_mode(value != 0); }
void pwm32x_set_muted(Core* p, std::uint32_t value) { p->set_muted(value != 0); }
void pwm32x_tick(Core* p) { p->tick(); }
void pwm32x_configure_timer(Core* p) { p->configure_timer(); }
std::uint32_t pwm32x_active(Core* p) { return p->active(); }
// Fields: configuration 0..4; public legacy chip/timer fields 5..12;
// current double-precision DAC output 13/14. -1 represents uninitialized DAC.
double pwm32x_get(Core* p, std::uint32_t field) {
  const auto& s = p->state();
  switch (field) {
    case 0: return p->clock(); case 1: return p->rate(); case 2: return p->gain();
    case 3: return p->output_mode(); case 4: return p->muted();
    case 5: return s.control; case 6: return s.cycle; case 7: return s.cycle_register;
    case 8: return s.left_valid ? static_cast<double>(s.left) : -1;
    case 9: return s.right_valid ? static_cast<double>(s.right) : -1;
    case 10: return s.timer_tick; case 11: return s.interrupt_count; case 12: return s.until_tick;
    case 13: case 14: { double l, r; p->output(l, r); return field == 13 ? l : r; }
    default: return 0;
  }
}
void pwm32x_set(Core* p, std::uint32_t field, double value) {
  auto s = p->state();
  switch (field) {
    case 0: p->set_clock(value); return; case 1: p->set_rate(static_cast<std::uint32_t>(value)); return;
    case 2: p->set_gain(value); return; case 3: p->set_output_mode(value != 0); return;
    case 4: p->set_muted(value != 0); return;
    case 5: s.control = static_cast<std::uint32_t>(value) & 0xffff; break;
    case 6: s.cycle = static_cast<std::uint32_t>(value) & 4095; break;
    case 7: s.cycle_register = static_cast<std::uint32_t>(value) & 4095; break;
    case 8: s.left_valid = value >= 0; s.left = value >= 0 ? static_cast<std::uint32_t>(value) & 0xffff : 0; break;
    case 9: s.right_valid = value >= 0; s.right = value >= 0 ? static_cast<std::uint32_t>(value) & 0xffff : 0; break;
    case 10: s.timer_tick = static_cast<std::uint32_t>(value); break;
    case 11: s.interrupt_count = value; break;
    case 12: s.until_tick = value; break;
    default: return;
  }
  p->load_state(s);
}
std::uint32_t pwm32x_fifo_count(Core* p, std::uint32_t side) { return side ? p->state().right_fifo.size : p->state().left_fifo.size; }
std::uint32_t pwm32x_fifo_get(Core* p, std::uint32_t side, std::uint32_t index) {
  const auto& fifo = side ? p->state().right_fifo : p->state().left_fifo;
  return index < fifo.size ? fifo.values[index] : 0;
}
void pwm32x_fifo_set(Core* p, std::uint32_t side, const std::uint16_t* values, std::uint32_t count) {
  auto s = p->state();
  auto& fifo = side ? s.right_fifo : s.left_fifo;
  fifo = tetorica::pwm32x::Fifo{};
  for (std::uint32_t i = 0; i < std::min(count, 3u); ++i) fifo.push(values[i]);
  p->load_state(s);
}
std::uint32_t pwm32x_state_size() { return sizeof(State); }
void pwm32x_save_state(Core* p, void* output) { std::memcpy(output, &p->state(), sizeof(State)); }
std::uint32_t pwm32x_load_state(Core* p, const void* input) {
  State state{};
  std::memcpy(&state, input, sizeof(State));
  return p->load_state(state);
}
}
