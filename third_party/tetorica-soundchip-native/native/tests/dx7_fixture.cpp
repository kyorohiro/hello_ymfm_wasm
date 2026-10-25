// Offline PCM comparison fixture. No audio device is opened.
// stdin: <frame> voice <id> <live0or1> <155-byte-hex>, on <midi> <velocity>,
// off <midi>, alloff, panic. stdout: interleaved float32 stereo PCM.
#include <tetorica/dx7.hpp>
#include <array>
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Request-size accounting only, excluding allocator headers/runtime globals.
struct alignas(std::max_align_t) Allocation { size_t size; };
static size_t heap_bytes = 0;
static uint64_t allocations = 0, frees = 0;
static int fail_after = -1;
void *operator new(size_t size) {
  if (fail_after == 0) throw std::bad_alloc();
  if (fail_after > 0) --fail_after;
  auto *block = static_cast<Allocation *>(std::malloc(sizeof(Allocation) + size));
  if (!block) throw std::bad_alloc();
  block->size = size; heap_bytes += size; ++allocations; return block + 1;
}
void *operator new[](size_t size) { return ::operator new(size); }
void operator delete(void *ptr) noexcept {
  if (!ptr) return;
  auto *block = static_cast<Allocation *>(ptr) - 1;
  heap_bytes -= block->size; ++frees; std::free(block);
}
void operator delete[](void *ptr) noexcept { ::operator delete(ptr); }
void operator delete(void *ptr, size_t) noexcept { ::operator delete(ptr); }
void operator delete[](void *ptr, size_t) noexcept { ::operator delete(ptr); }

static std::array<uint8_t, 155> sine_voice() {
  std::array<uint8_t, 155> voice{};
  for (int op = 0; op < 6; ++op) {
    auto *p = voice.data() + op * 21;
    p[0] = p[1] = p[2] = 99; p[3] = 75;
    p[4] = p[5] = p[6] = 99; p[7] = 0; p[8] = 39;
    p[16] = op == 5 ? 85 : 0; p[18] = 1; p[20] = 7;
  }
  for (int i = 126; i < 130; ++i) voice[i] = 99;
  for (int i = 130; i < 134; ++i) voice[i] = 50;
  voice[134] = 31; voice[136] = 1; voice[141] = 1;
  voice[144] = 24;
  for (int i = 145; i < 155; ++i) voice[i] = 32;
  return voice;
}

// Native SDK checks supplement the imported comparison CLI without changing
// its event grammar or PCM format. All audited control/render work is on
// already-created instances, so setup allocations are measured separately.
static double equal_samples(void *a, void *b, int frames) {
  double energy = 0;
  for (int frame = 0; frame < frames; ++frame) {
    const float left = native_dx7_sample(a), right = native_dx7_sample(b);
    assert(std::isfinite(left) && left == right);
    energy += static_cast<double>(left) * left;
  }
  return energy;
}

static double different_samples(void *a, void *b, int frames) {
  double difference = 0;
  for (int frame = 0; frame < frames; ++frame) {
    const float left = native_dx7_sample(a), right = native_dx7_sample(b);
    assert(std::isfinite(left) && std::isfinite(right));
    difference += std::abs(static_cast<double>(left) - right);
  }
  return difference;
}

static void panic_feedback_checks() {
  const auto baseline = heap_bytes;
  auto voice = sine_voice();
  for (int op = 0; op < 6; ++op) {
    voice[op * 21 + 16] = 85;
    voice[op * 21 + 18] = 6 - op;
  }
  voice[135] = 7; voice[141] = 0;
  for (uint32_t rate : {44100u, 48000u, 96000u}) for (uint8_t algorithm = 0; algorithm < 32; ++algorithm) {
    voice[134] = algorithm;
    auto *restarted = native_dx7_create(rate), *fresh = native_dx7_create(rate);
    assert(restarted && fresh);
    const auto before_alloc = allocations, before_free = frees;
    native_dx7_voice(restarted, voice.data(), 31, false); native_dx7_voice(fresh, voice.data(), 31, false);
    assert(native_dx7_note_on(restarted, 60, 100) == 0);
    for (int frame = 0; frame < 1301; ++frame) assert(std::isfinite(native_dx7_sample(restarted)));
    // Reusing preallocated notes must reset their feedback history as well as
    // the shared filter/cache. A fresh synth is an independent restart oracle.
    native_dx7_panic(restarted);
    assert(equal_samples(restarted, fresh, 102) == 0);
    assert(native_dx7_note_on(restarted, 72, 100) == 0 && native_dx7_note_on(fresh, 72, 100) == 0);
    assert(equal_samples(restarted, fresh, 6789) > 0.001);
    assert(allocations == before_alloc && frees == before_free);
    native_dx7_destroy(restarted); native_dx7_destroy(fresh);
    assert(heap_bytes == baseline);
  }
}

static void native_sdk_checks() {
  const auto baseline = heap_bytes;
  const auto rejected_alloc = allocations, rejected_free = frees;
  for (uint32_t rate : {0u, 7999u, 384001u, UINT32_MAX}) assert(!native_dx7_create(rate));
  assert(allocations == rejected_alloc && frees == rejected_free);
  auto voice = sine_voice();
  // Both accepted boundaries, source rate, common resampling rates, and a
  // lower-than-source output rate exercise source skipping and interpolation.
  for (uint32_t rate : {8000u, 22050u, 44100u, 48000u, 96000u, 384000u}) {
    auto *a = native_dx7_create(rate), *b = native_dx7_create(rate);
    assert(a && b);
    const auto before_alloc = allocations, before_free = frees;
    native_dx7_voice(a, voice.data(), 11, false); native_dx7_voice(b, voice.data(), 11, false);
    assert(native_dx7_note_on(a, 69, 100) == 0 && native_dx7_note_on(b, 69, 100) == 0);
    assert(equal_samples(a, b, 4096) > 0.001);
    // Out-of-range slot operations are no-ops even while a voice is sounding.
    native_dx7_release_slot(a, 16); native_dx7_release_slot(a, 255);
    native_dx7_kill_slot(a, 16); native_dx7_kill_slot(a, 255);
    assert(equal_samples(a, b, 257) > 0.001);
    native_dx7_panic(a); native_dx7_panic(b);
    assert(equal_samples(a, b, 257) == 0);
    assert(allocations == before_alloc && frees == before_free);
    native_dx7_destroy(a); native_dx7_destroy(b);
    assert(heap_bytes == baseline);
  }
  {
    auto *a = native_dx7_create(48000), *b = native_dx7_create(48000);
    assert(a && b);
    const auto before_alloc = allocations, before_free = frees;
    native_dx7_voice(a, voice.data(), 11, false); native_dx7_voice(b, voice.data(), 11, false);
    // A host lease protects a slot even before it has a note. Rejected
    // allocations must leave the round-robin cursor unchanged.
    assert(native_dx7_note_on_mask(a, 60, 100, 0xffff) == -1);
    assert(native_dx7_note_on_mask(a, 60, 100, 0xffdf) == 5);
    assert(native_dx7_note_on_mask(b, 60, 100, 0xffdf) == 5);
    assert(native_dx7_note_on_mask(a, 61, 100, 0xffff) == -1);
    assert(native_dx7_note_on(a, 61, 100) == 6 && native_dx7_note_on(b, 61, 100) == 6);
    assert(equal_samples(a, b, 257) > 0.001);
    native_dx7_panic(a); native_dx7_panic(b);
    for (int slot = 0; slot < 16; ++slot) {
      assert(native_dx7_note_on(a, 48 + slot, 100) == slot);
      assert(native_dx7_note_on(b, 48 + slot, 100) == slot);
    }
    assert(native_dx7_note_on(a, 90, 100) == -1);
    assert(equal_samples(a, b, 257) > 0.001);
    for (int slot = 0; slot < 16; ++slot) {
      native_dx7_release_slot(a, slot); native_dx7_release_slot(b, slot);
    }
    assert(native_dx7_note_on_mask(a, 76, 100, 0xffff) == -1);
    assert(native_dx7_note_on_mask(a, 76, 100, 0xfffe) == 0);
    assert(native_dx7_note_on_mask(b, 76, 100, 0xfffe) == 0);
    assert(equal_samples(a, b, 257) > 0.001);
    assert(allocations == before_alloc && frees == before_free);
    native_dx7_destroy(a); native_dx7_destroy(b);
    assert(heap_bytes == baseline);
  }
  {
    auto *a = native_dx7_create(48000), *b = native_dx7_create(48000);
    assert(a && b);
    const auto before_alloc = allocations, before_free = frees;
    native_dx7_voice(a, voice.data(), 11, false); native_dx7_voice(b, voice.data(), 11, false);
    for (uint8_t note : {69, 57}) assert(native_dx7_note_on(a, note, 100) == native_dx7_note_on(b, note, 100));
    assert(equal_samples(a, b, 257) > 0.001);
    native_dx7_kill_slot(a, 0); native_dx7_kill_slot(b, 0);
    equal_samples(a, b, 4096); // Drain the pre-mixed block and filter response.
    assert(equal_samples(a, b, 4096) > 0.001); // The second slot still computes.
    native_dx7_kill_slot(a, 1);
    assert(different_samples(a, b, 4096) > 1.0);
    native_dx7_panic(a);
    for (int frame = 0; frame < 257; ++frame) assert(native_dx7_sample(a) == 0);
    assert(allocations == before_alloc && frees == before_free);
    native_dx7_destroy(a); native_dx7_destroy(b);
    assert(heap_bytes == baseline);
  }
  auto changed = voice;
  changed[121] = 62; // Carrier output level.
  changed[123] = 2;  // Carrier coarse frequency.
  for (bool released : {false, true}) {
    auto *a = native_dx7_create(48000), *b = native_dx7_create(48000);
    assert(a && b);
    const auto before_alloc = allocations, before_free = frees;
    native_dx7_voice(a, voice.data(), 11, false); native_dx7_voice(b, voice.data(), 11, false);
    assert(native_dx7_note_on(a, 69, 100) == 0 && native_dx7_note_on(b, 69, 100) == 0);
    assert(equal_samples(a, b, 4097) > 0.001);
    if (released) { native_dx7_release_slot(a, 0); native_dx7_release_slot(b, 0); }
    native_dx7_voice(a, changed.data(), 11, true);
    // Matching identities update both held and releasing notes after the
    // already-rendered source block has drained.
    assert(different_samples(a, b, 4096) > 0.1);
    assert(allocations == before_alloc && frees == before_free);
    native_dx7_destroy(a); native_dx7_destroy(b);
    assert(heap_bytes == baseline);
  }
  {
    auto *a = native_dx7_create(48000), *b = native_dx7_create(48000);
    assert(a && b);
    const auto before_alloc = allocations, before_free = frees;
    native_dx7_voice(a, voice.data(), 11, false); native_dx7_voice(b, voice.data(), 11, false);
    assert(native_dx7_note_on(a, 69, 100) == 0 && native_dx7_note_on(b, 69, 100) == 0);
    assert(equal_samples(a, b, 257) > 0.001);
    // Unexpected live-edit identities select a future voice. Neither this
    // selection nor a subsequent edit of ID22 may alter sounding ID11 notes.
    native_dx7_voice(a, changed.data(), 22, true); native_dx7_voice(b, voice.data(), 22, false);
    native_dx7_voice(a, voice.data(), 22, true); native_dx7_voice(a, changed.data(), 22, true);
    assert(equal_samples(a, b, 4096) > 0.001);
    assert(native_dx7_note_on(a, 57, 100) == 1 && native_dx7_note_on(b, 57, 100) == 1);
    assert(different_samples(a, b, 4096) > 1.0);
    assert(allocations == before_alloc && frees == before_free);
    native_dx7_destroy(a); native_dx7_destroy(b);
    assert(heap_bytes == baseline);
  }
  native_dx7_destroy(nullptr);
}

static int self_test() {
  auto *warm = native_dx7_create(48000); assert(warm); native_dx7_destroy(warm);
  const auto base = heap_bytes;
  for (int failure = 0; failure < 17; ++failure) {
    fail_after = failure;
    assert(!native_dx7_create(48000));
    fail_after = -1;
    assert(heap_bytes == base); // Including all partially allocated note arrays.
  }
  auto *a = native_dx7_create(48000), *b = native_dx7_create(48000), *other = native_dx7_create(96000);
  assert(a && b && other);
  const auto core_bytes = native_dx7_core_size();
  assert(heap_bytes - base == core_bytes * 3);
  auto voice = sine_voice(), distinct = voice;
  distinct[137] = 78; distinct[139] = 31; distinct[140] = 22;
  distinct[142] = 4; distinct[143] = 3; distinct[123] = 3;
  native_dx7_voice(a, voice.data(), 1, false); native_dx7_voice(b, voice.data(), 1, false);
  native_dx7_voice(other, distinct.data(), 71, false);
  assert(native_dx7_note_on(a, 69, 100) == 0 && native_dx7_note_on(b, 69, 100) == 0);
  assert(native_dx7_note_on(other, 33, 127) == 0);
  double energy = 0;
  const auto before_alloc = allocations, before_free = frees;
  for (int frame = 0; frame < 16000; ++frame) {
    if (frame == 701) { voice[123] = 2; native_dx7_voice(a, voice.data(), 1, true); native_dx7_voice(b, voice.data(), 1, true); }
    if (frame == 1403) { native_dx7_release_slot(a, 0); native_dx7_release_slot(b, 0); }
    if (frame == 2101) { native_dx7_panic(a); native_dx7_panic(b); native_dx7_note_on(a, 60, 80); native_dx7_note_on(b, 60, 80); }
    if (frame % 127 == 0) { distinct[135] = (frame / 127) & 7; native_dx7_voice(other, distinct.data(), 71, true); }
    const float left = native_dx7_sample(a), expected = native_dx7_sample(b);
    assert(std::isfinite(left) && left == expected); energy += left * left;
    // Rendering a different-rate instance advances its own LFO/filter/source
    // cache and cannot mutate the lookup tables or either reference instance.
    for (int i = 0; i < (frame % 3) + 1; ++i) assert(std::isfinite(native_dx7_sample(other)));
  }
  assert(energy > 0.01);
  native_dx7_panic(a);
  for (int slot = 0; slot < 16; ++slot) assert(native_dx7_note_on(a, 48 + slot, 100) == slot);
  assert(native_dx7_note_on(a, 76, 100) == -1);
  for (int slot = 0; slot < 16; ++slot) native_dx7_release_slot(a, slot);
  assert(native_dx7_note_on_mask(a, 76, 100, 0xffff) == -1);
  assert(native_dx7_note_on_mask(a, 76, 100, 0xfffe) == 0);
  native_dx7_kill_slot(a, 0);
  assert(native_dx7_note_on_mask(a, 77, 100, 0xfffe) == 0);
  for (int slot = 0; slot < 16; ++slot) native_dx7_kill_slot(a, slot);
  for (int frame = 0; frame < 4096; ++frame) assert(std::isfinite(native_dx7_sample(a)));
  native_dx7_panic(a);
  for (int frame = 0; frame < 257; ++frame) assert(native_dx7_sample(a) == 0);
  assert(allocations == before_alloc && frees == before_free);
  native_dx7_destroy(a); native_dx7_destroy(b); native_dx7_destroy(other);
  assert(heap_bytes == base);
  native_sdk_checks();
  panic_feedback_checks();
  assert(heap_bytes == base);
  std::cout << "{\"status\":\"passed\",\"coreHeapBytes\":" << core_bytes
    << ",\"allocatedNoteObjects\":16,\"partialCreateFailures\":17,\"renderAllocations\":0,\"renderFrees\":0,\"independentLfoFilterResampler\":true,\"protectedSlotAllocation\":true,\"singleSlotKill\":true,\"rateBounds\":true,\"invalidSlotNoOp\":true,\"protectedFreeSlotsAndTails\":true,\"heldPolyphonyCapacity\":16,\"heldAndReleasedLiveEdits\":true,\"voiceIdentityIsolation\":true,\"panicImmediateSilence\":true,\"panicFeedbackRestarts\":96}\n";
  return 0;
}

struct Event {
  uint32_t frame = 0, id = 0;
  int live = 0, note = 0, velocity = 0;
  std::string op;
  std::array<uint8_t, 155> voice{};
};
int main(int argc, char **argv) {
  void *core = nullptr;
  try {
    if (argc == 2 && std::string(argv[1]) == "--self-test") return self_test();
    if (argc != 3) throw std::runtime_error("Usage: fixture sample-rate frames");
    const auto rate = static_cast<uint32_t>(std::stoul(argv[1]));
    const auto frames = static_cast<uint32_t>(std::stoul(argv[2]));
    if (!frames || frames > 16 * 1024 * 1024) throw std::runtime_error("Invalid frames");
    core = native_dx7_create(rate);
    if (!core) throw std::runtime_error("Could not create Native DX7");
    std::vector<Event> events;
    for (std::string line; std::getline(std::cin, line);) {
      if (line.empty()) continue;
      std::istringstream input(line); Event event;
      if (!(input >> event.frame >> event.op) || event.frame >= frames) throw std::runtime_error("Invalid event");
      if (event.op == "voice") {
        std::string hex;
        if (!(input >> event.id >> event.live >> hex) || !event.id || (event.live != 0 && event.live != 1) || hex.size() != 310) throw std::runtime_error("Invalid voice");
        for (size_t index = 0; index < event.voice.size(); ++index) {
          const auto value = std::stoul(hex.substr(index * 2, 2), nullptr, 16);
          if (value > 127) throw std::runtime_error("Invalid voice byte");
          event.voice[index] = static_cast<uint8_t>(value);
        }
      } else if (event.op == "on") {
        if (!(input >> event.note >> event.velocity) || event.note < 0 || event.note > 127 || event.velocity < 0 || event.velocity > 127) throw std::runtime_error("Invalid note-on");
      } else if (event.op == "off") {
        if (!(input >> event.note) || event.note < 0 || event.note > 127) throw std::runtime_error("Invalid note-off");
      } else if (event.op != "alloff" && event.op != "panic") throw std::runtime_error("Unknown event");
      events.push_back(event);
    }
    std::stable_sort(events.begin(), events.end(), [](const Event &left, const Event &right) { return left.frame < right.frame; });
    std::array<int, 16> noteForSlot{}; noteForSlot.fill(-1);
    const auto release = [&](int midi) {
      for (size_t slot = 0; slot < noteForSlot.size(); ++slot) if (midi < 0 || noteForSlot[slot] == midi) {
        native_dx7_release_slot(core, static_cast<uint8_t>(slot)); noteForSlot[slot] = -1;
      }
    };
    std::vector<float> pcm(static_cast<size_t>(frames) * 2);
    size_t next = 0;
    for (uint32_t frame = 0; frame < frames; ++frame) {
      while (next < events.size() && events[next].frame == frame) {
        const auto &event = events[next++];
        if (event.op == "voice") native_dx7_voice(core, event.voice.data(), event.id, event.live != 0);
        else if (event.op == "on" && event.velocity) {
          const int slot = native_dx7_note_on(core, static_cast<uint8_t>(event.note), static_cast<uint8_t>(event.velocity));
          // The shipped MSFA allocator drops an extra held key at capacity.
          if (slot >= 16) throw std::runtime_error("Invalid allocated slot");
          if (slot >= 0) noteForSlot[slot] = event.note;
        } else if (event.op == "off" || event.op == "on") release(event.note);
        else if (event.op == "alloff") release(-1);
        else if (event.op == "panic") { native_dx7_panic(core); noteForSlot.fill(-1); }
      }
      const auto sample = native_dx7_sample(core);
      pcm[frame * 2] = pcm[frame * 2 + 1] = sample;
    }
    native_dx7_destroy(core); core = nullptr;
    std::cout.write(reinterpret_cast<const char *>(pcm.data()), static_cast<std::streamsize>(pcm.size() * sizeof(float)));
    if (!std::cout) throw std::runtime_error("Could not write PCM");
    return 0;
  } catch (const std::exception &error) {
    if (core) native_dx7_destroy(core);
    std::cerr << error.what() << '\n'; return 1;
  }
}
