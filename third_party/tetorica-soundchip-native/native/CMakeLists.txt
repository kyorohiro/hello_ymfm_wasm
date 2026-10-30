cmake_minimum_required(VERSION 3.20)

# Also allow `cmake -S native -B build/native` without a parent application.
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  project(tetorica_soundchip_native_core LANGUAGES C CXX)
  include(CTest)
endif()

get_filename_component(TETORICA_SDK_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
option(TETORICA_NATIVE_BUILD_TESTS "Build the standalone Native core tests" ON)
option(TETORICA_NATIVE_BUILD_EXAMPLES "Build the standalone Native examples" ON)

# Application-owned PCM transports. Keep the original C ABI and C11 sources;
# these modules own no device, machine, source allocation, or Tauri dependency.
foreach(component IN ITEMS cdda msm5205)
  add_library(tetorica_native_${component} STATIC
    "${TETORICA_SDK_ROOT}/vendor/tetorica-${component}/${component}_pcm.c")
  add_library(tetorica::${component} ALIAS tetorica_native_${component})
  target_compile_features(tetorica_native_${component} PUBLIC c_std_11)
  target_include_directories(tetorica_native_${component} PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${TETORICA_SDK_ROOT}/vendor/tetorica-${component}")
endforeach()

# First independently buildable component. The Native-owned provider explicitly
# instantiates adapter templates without changing the pinned ymfm source bytes.
# No Rust, Tauri, CPAL, device, or fetch is used.
add_library(tetorica_native_ym2612 STATIC
  reference/tauri/native_genesis_ym2612.cpp
  src/ymfm_opn_provider.cpp
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_ssg.cpp"
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_adpcm.cpp"
)
add_library(tetorica::ym2612 ALIAS tetorica_native_ym2612)
target_compile_features(tetorica_native_ym2612 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_ym2612
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_ym2612 PRIVATE /EHsc)
endif()

# Alternative YM2612 engine. The C++ wrapper includes the unchanged Browser
# adapter and Native policy once. Compile the upstream provider as C, with all
# external OPN2 names prefixed, so it can coexist with ymfm and other providers.
set(TETORICA_NUKED_SYMBOLS
  OPN2_Reset OPN2_SetChipType OPN2_Clock OPN2_Write OPN2_SetTestPin
  OPN2_ReadTestPin OPN2_ReadIRQPin OPN2_Read
)
set(TETORICA_NUKED_PROVIDER "${TETORICA_SDK_ROOT}/vendor/nuked-opn2/ym3438.c")
foreach(symbol IN LISTS TETORICA_NUKED_SYMBOLS)
  set_property(SOURCE "${TETORICA_NUKED_PROVIDER}" APPEND PROPERTY
    COMPILE_DEFINITIONS "${symbol}=tetorica_nuked_${symbol}")
endforeach()
# Retain the original Native C provider's signed-wrap semantics only for this
# source; unrelated C/C++ cores and consumers keep their own compiler options.
include(CheckCCompilerFlag)
check_c_compiler_flag("-fwrapv" TETORICA_NUKED_C_SUPPORTS_WRAPV)
if(TETORICA_NUKED_C_SUPPORTS_WRAPV)
  set_property(SOURCE "${TETORICA_NUKED_PROVIDER}" APPEND PROPERTY COMPILE_OPTIONS -fwrapv)
endif()
add_library(tetorica_native_nuked_ym2612 STATIC
  reference/tauri/native_genesis_nuked.cpp
  "${TETORICA_NUKED_PROVIDER}"
)
add_library(tetorica::nuked_ym2612 ALIAS tetorica_native_nuked_ym2612)
target_compile_features(tetorica_native_nuked_ym2612 PUBLIC cxx_std_14 PRIVATE c_std_11)
target_include_directories(tetorica_native_nuked_ym2612
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/nuked-opn2"
    "${TETORICA_SDK_ROOT}/wasm"
)
# Nuked's upstream chip type is process-global. The Native wrapper selects
# YM2612 once with std::call_once before publishing the first handle.
find_package(Threads REQUIRED)
target_link_libraries(tetorica_native_nuked_ym2612 PRIVATE Threads::Threads)
if(MSVC)
  target_compile_options(tetorica_native_nuked_ym2612 PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:/EHsc>")
endif()

add_library(tetorica_native_ym2151 STATIC
  reference/tauri/native_genesis_ym2151.cpp
  src/ymfm_opm_provider.cpp
)
add_library(tetorica::ym2151 ALIAS tetorica_native_ym2151)
target_compile_features(tetorica_native_ym2151 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_ym2151
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_ym2151 PRIVATE /EHsc)
endif()

add_library(tetorica_native_segapsg STATIC
  reference/tauri/native_genesis_game_gear.cpp
  "${TETORICA_SDK_ROOT}/vendor/tetorica_sega_psg/segapsg.cpp"
)
add_library(tetorica::segapsg ALIAS tetorica_native_segapsg)
target_compile_features(tetorica_native_segapsg PUBLIC cxx_std_14)
target_include_directories(tetorica_native_segapsg
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/tetorica_sega_psg"
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
)
if(MSVC)
  target_compile_options(tetorica_native_segapsg PRIVATE /EHsc)
endif()

add_library(tetorica_native_ym2413 STATIC
  reference/tauri/native_genesis_ym2413.cpp
  src/ymfm_opl_provider.cpp
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_adpcm.cpp"
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_pcm.cpp"
)
add_library(tetorica::ym2413 ALIAS tetorica_native_ym2413)
target_compile_features(tetorica_native_ym2413 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_ym2413
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_ym2413 PRIVATE /EHsc)
endif()

add_library(tetorica_native_ay8910 STATIC
  reference/tauri/native_genesis_ay8910.cpp
  "${TETORICA_SDK_ROOT}/vendor/mame-ay8910/ay8910.cpp"
)
add_library(tetorica::ay8910 ALIAS tetorica_native_ay8910)
target_compile_features(tetorica_native_ay8910 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_ay8910
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/mame-ay8910"
)
if(MSVC)
  target_compile_options(tetorica_native_ay8910 PRIVATE /EHsc)
endif()

add_library(tetorica_native_ym2203 STATIC
  reference/tauri/native_genesis_ym2203.cpp
  src/ymfm_opn_provider.cpp
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_ssg.cpp"
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_adpcm.cpp"
)
add_library(tetorica::ym2203 ALIAS tetorica_native_ym2203)
target_compile_features(tetorica_native_ym2203 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_ym2203
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_ym2203 PRIVATE /EHsc)
endif()

add_library(tetorica_native_ym2608 STATIC
  reference/tauri/native_genesis_ym2608.cpp
  src/ymfm_opn_provider.cpp
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_ssg.cpp"
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_adpcm.cpp"
)
add_library(tetorica::ym2608 ALIAS tetorica_native_ym2608)
target_compile_features(tetorica_native_ym2608 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_ym2608
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_ym2608 PRIVATE /EHsc)
endif()

add_library(tetorica_native_ym2610 STATIC
  reference/tauri/native_genesis_ym2610b.cpp
  src/ymfm_opn_provider.cpp
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_ssg.cpp"
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_adpcm.cpp"
)
add_library(tetorica::ym2610 ALIAS tetorica_native_ym2610)
add_library(tetorica::ym2610b ALIAS tetorica_native_ym2610)
target_compile_features(tetorica_native_ym2610 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_ym2610
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_ym2610 PRIVATE /EHsc)
endif()

add_library(tetorica_native_okim6258 STATIC
  reference/tauri/native_genesis_extra_okim6258.cpp
  "${TETORICA_SDK_ROOT}/vendor/mame-okim6258/okim6258.cpp"
)
add_library(tetorica::okim6258 ALIAS tetorica_native_okim6258)
target_compile_features(tetorica_native_okim6258 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_okim6258
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/mame-okim6258"
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
)
if(MSVC)
  target_compile_options(tetorica_native_okim6258 PRIVATE /EHsc)
endif()

add_library(tetorica_native_rf5c164 STATIC
  reference/tauri/native_genesis_rf5c164.cpp
  reference/tauri/native_genesis_extra_rf5c164.cpp
  "${TETORICA_SDK_ROOT}/vendor/mame-rf5c164/rf5c164.cpp"
)
add_library(tetorica::rf5c164 ALIAS tetorica_native_rf5c164)
target_compile_features(tetorica_native_rf5c164 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_rf5c164
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/mame-rf5c164"
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
)
if(MSVC)
  target_compile_options(tetorica_native_rf5c164 PRIVATE /EHsc)
endif()

add_library(tetorica_native_opl STATIC
  reference/tauri/native_genesis_opl.cpp
  reference/tauri/native_genesis_extra_opl.cpp
  src/ymfm_opl_provider.cpp
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_adpcm.cpp"
  "${TETORICA_SDK_ROOT}/vendor/ymfm/ymfm_pcm.cpp"
)
add_library(tetorica::opl ALIAS tetorica_native_opl)
add_library(tetorica::ym3526 ALIAS tetorica_native_opl)
add_library(tetorica::ym3812 ALIAS tetorica_native_opl)
add_library(tetorica::ymf262 ALIAS tetorica_native_opl)
add_library(tetorica::y8950 ALIAS tetorica_native_opl)
target_compile_features(tetorica_native_opl PUBLIC cxx_std_14)
target_include_directories(tetorica_native_opl
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/ymfm"
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_opl PRIVATE /EHsc)
endif()

add_library(tetorica_native_gameboy STATIC
  reference/tauri/native_genesis_gameboy.cpp
  "${TETORICA_SDK_ROOT}/vendor/mame-gameboy/gameboy_apu.cpp"
)
add_library(tetorica::gameboy ALIAS tetorica_native_gameboy)
target_compile_features(tetorica_native_gameboy PUBLIC cxx_std_14)
target_include_directories(tetorica_native_gameboy
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/mame-gameboy"
)
if(MSVC)
  target_compile_options(tetorica_native_gameboy PRIVATE /EHsc)
endif()

# The wrapper includes the snapshotted implementation after exposing its state
# for observation. Compile it once; a separate huc6280.cpp would duplicate symbols.
add_library(tetorica_native_huc6280 STATIC
  reference/tauri/native_genesis_huc6280.cpp
)
add_library(tetorica::huc6280 ALIAS tetorica_native_huc6280)
target_compile_features(tetorica_native_huc6280 PUBLIC cxx_std_14)
target_include_directories(tetorica_native_huc6280
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/mame-huc6280"
)
if(MSVC)
  target_compile_options(tetorica_native_huc6280 PRIVATE /EHsc)
endif()

# This pinned C++ JSNES/FDS port is self-contained. The separately inventoried
# vendor/tetorica-nes/nes_core.cpp exports the same C ABI and must not be linked.
add_library(tetorica_native_nes STATIC
  reference/tauri/native_genesis_nes.cpp
)
add_library(tetorica::nes ALIAS tetorica_native_nes)
target_compile_features(tetorica_native_nes PUBLIC cxx_std_17)
target_include_directories(tetorica_native_nes
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
)
if(MSVC)
  target_compile_options(tetorica_native_nes PRIVATE /EHsc)
endif()
# Preserve the original Tauri build's JavaScript integer and floating-point
# semantics without imposing these flags on consumers or unrelated chip cores.
include(CheckCXXCompilerFlag)
foreach(flag IN ITEMS -fwrapv -fno-strict-aliasing -ffp-contract=off)
  string(MAKE_C_IDENTIFIER "TETORICA_NES_SUPPORTS_${flag}" supported_flag)
  check_cxx_compiler_flag("${flag}" "${supported_flag}")
  if(${supported_flag})
    target_compile_options(tetorica_native_nes PRIVATE "${flag}")
  endif()
endforeach()

# The exact browser/WASM FIFO and timer core is header-only; the pinned
# native wrapper supplies the C ABI and host-owned tag cancellation metadata.
add_library(tetorica_native_pwm STATIC
  reference/tauri/native_genesis_pwm.cpp
)
add_library(tetorica::pwm ALIAS tetorica_native_pwm)
target_compile_features(tetorica_native_pwm PUBLIC cxx_std_17)
target_include_directories(tetorica_native_pwm
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/wasm"
)
if(MSVC)
  target_compile_options(tetorica_native_pwm PRIVATE /EHsc)
endif()
# Match the original Tauri PWM build's floating-point evaluation order.
check_cxx_compiler_flag("-ffp-contract=off" TETORICA_PWM_SUPPORTS_NO_FP_CONTRACT)
if(TETORICA_PWM_SUPPORTS_NO_FP_CONTRACT)
  target_compile_options(tetorica_native_pwm PRIVATE -ffp-contract=off)
endif()

# MSFA's quoted includes search beside each .cc first. Assemble one private
# tree so every translation unit sees the Native headers, including the shared
# sources; an include-path override alone would silently select vendor headers.
set(TETORICA_DX7_MSFA_DIR "${CMAKE_CURRENT_BINARY_DIR}/msfa")
set(TETORICA_DX7_MSFA_SOURCES
  dx7note.cc env.cc exp2.cc fm_core.cc fm_op_kernel.cc freqlut.cc lfo.cc
  patch.cc pitchenv.cc resofilter.cc ringbuffer.cc sin.cc synth_unit.cc
)
set(TETORICA_DX7_MSFA_HEADERS
  aligned_buf.h controllers.h dx7note.h env.h exp2.h fm_core.h fm_op_kernel.h
  freqlut.h lfo.h module.h patch.h pitchenv.h resofilter.h ringbuffer.h sin.h
  synth.h synth_unit.h
)
set(TETORICA_DX7_MSFA_OVERRIDES
  dx7note.cc env.cc ringbuffer.cc synth.h synth_unit.cc synth_unit.h
)
set(TETORICA_DX7_ASSEMBLED_SOURCES)
foreach(msfa_file IN LISTS TETORICA_DX7_MSFA_SOURCES TETORICA_DX7_MSFA_HEADERS)
  if(msfa_file IN_LIST TETORICA_DX7_MSFA_OVERRIDES)
    set(msfa_input "${CMAKE_CURRENT_LIST_DIR}/reference/overrides/msfa/${msfa_file}")
  else()
    set(msfa_input "${TETORICA_SDK_ROOT}/vendor/msfa/${msfa_file}")
  endif()
  configure_file("${msfa_input}" "${TETORICA_DX7_MSFA_DIR}/${msfa_file}" COPYONLY)
  if(msfa_file IN_LIST TETORICA_DX7_MSFA_SOURCES)
    list(APPEND TETORICA_DX7_ASSEMBLED_SOURCES "${TETORICA_DX7_MSFA_DIR}/${msfa_file}")
  endif()
endforeach()
add_library(tetorica_native_dx7 STATIC
  reference/tauri/native_genesis_dx7.cpp
  ${TETORICA_DX7_ASSEMBLED_SOURCES}
)
add_library(tetorica::dx7 ALIAS tetorica_native_dx7)
target_compile_features(tetorica_native_dx7 PUBLIC cxx_std_17)
target_compile_definitions(tetorica_native_dx7 PRIVATE MSFA_FORCE_SCALAR _USE_MATH_DEFINES)
target_include_directories(tetorica_native_dx7
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_DX7_MSFA_DIR}"
)
# std::call_once and the portable ring-buffer wait need the platform thread
# dependency even when this static library is consumed outside this project.
find_package(Threads REQUIRED)
target_link_libraries(tetorica_native_dx7 PRIVATE Threads::Threads)
if(MSVC)
  target_compile_options(tetorica_native_dx7 PRIVATE /EHsc)
endif()
# Preserve the original Tauri build's scalar integer/FP semantics without
# applying implementation flags to consumers or the other chip libraries.
foreach(flag IN ITEMS -fwrapv -fno-strict-aliasing -ffp-contract=off)
  string(MAKE_C_IDENTIFIER "TETORICA_DX7_SUPPORTS_${flag}" supported_flag)
  check_cxx_compiler_flag("${flag}" "${supported_flag}")
  if(${supported_flag})
    target_compile_options(tetorica_native_dx7 PRIVATE "${flag}")
  endif()
endforeach()

# Accurate standalone S-DSP only. SPC700 CPU/player sources belong to the
# separate SPC integration and are not linked into this instrument target.
add_library(tetorica_native_snes STATIC
  reference/tauri/native_genesis_snes.cpp
  "${TETORICA_SDK_ROOT}/vendor/snes-spc/snes_spc/SPC_DSP.cpp"
)
add_library(tetorica::snes ALIAS tetorica_native_snes)
target_compile_features(tetorica_native_snes PUBLIC cxx_std_17)
target_include_directories(tetorica_native_snes
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/snes-spc/snes_spc"
)
if(MSVC)
  target_compile_options(tetorica_native_snes PRIVATE /EHsc)
endif()
# Retain the original Tauri S-DSP build's integer and floating-point semantics.
foreach(flag IN ITEMS -fwrapv -fno-strict-aliasing -ffp-contract=off)
  string(MAKE_C_IDENTIFIER "TETORICA_SNES_SUPPORTS_${flag}" supported_flag)
  check_cxx_compiler_flag("${flag}" "${supported_flag}")
  if(${supported_flag})
    target_compile_options(tetorica_native_snes PRIVATE "${flag}")
  endif()
endforeach()

# The complete SPC700 player shares the accurate DSP implementation with the
# S-DSP instrument, but has independent state and no output device or IPL image.
# Keep SPC_DSP.cpp as a separate archive member in each independently usable
# target. Ordinary static linking extracts that identical member only once when
# both targets are used; no consumer must link an extra internal DSP archive.
add_library(tetorica_native_spc STATIC
  reference/tauri/native_genesis_spc.cpp
  "${TETORICA_SDK_ROOT}/vendor/snes-spc/snes_spc/SNES_SPC.cpp"
  "${TETORICA_SDK_ROOT}/vendor/snes-spc/snes_spc/SNES_SPC_misc.cpp"
  "${TETORICA_SDK_ROOT}/vendor/snes-spc/snes_spc/SNES_SPC_state.cpp"
  "${TETORICA_SDK_ROOT}/vendor/snes-spc/snes_spc/SPC_DSP.cpp"
)
add_library(tetorica::spc ALIAS tetorica_native_spc)
target_compile_features(tetorica_native_spc PUBLIC cxx_std_17)
target_include_directories(tetorica_native_spc
  PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${CMAKE_CURRENT_LIST_DIR}/reference/tauri"
  PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/snes-spc/snes_spc"
)
if(MSVC)
  target_compile_options(tetorica_native_spc PRIVATE /EHsc)
endif()
foreach(flag IN ITEMS -fwrapv -fno-strict-aliasing -ffp-contract=off)
  string(MAKE_C_IDENTIFIER "TETORICA_SPC_SUPPORTS_${flag}" supported_flag)
  check_cxx_compiler_flag("${flag}" "${supported_flag}")
  if(${supported_flag})
    target_compile_options(tetorica_native_spc PRIVATE "${flag}")
  endif()
endforeach()

# Self-contained raw WonderSwan C++ core. This target intentionally provides no
# Tauri ABI or speaker DSP: the public facade forwards the exact vendor header.
# Its source-relative include keeps vendor headers out of other consumers' paths.
add_library(tetorica_native_wonderswan STATIC
  "${TETORICA_SDK_ROOT}/vendor/mame-wonderswan/wonderswan.cpp"
)
add_library(tetorica::wonderswan ALIAS tetorica_native_wonderswan)
target_compile_features(tetorica_native_wonderswan PUBLIC cxx_std_14)
target_include_directories(tetorica_native_wonderswan PUBLIC
  "${CMAKE_CURRENT_LIST_DIR}/include"
)
if(MSVC)
  target_compile_options(tetorica_native_wonderswan PRIVATE /EHsc)
endif()

# The standalone BSD POKEY adaptation includes the retained sound algorithm
# without libvgm's integration headers. Each object owns one four-channel chip;
# hosts compose two objects for dual-POKEY machines.
add_library(tetorica_native_pokey STATIC
  "${TETORICA_SDK_ROOT}/vendor/libvgm-pokey/pokey.cpp"
)
add_library(tetorica::pokey ALIAS tetorica_native_pokey)
target_compile_features(tetorica_native_pokey PUBLIC cxx_std_14)
target_include_directories(tetorica_native_pokey PUBLIC
  "${CMAKE_CURRENT_LIST_DIR}/include"
)
if(MSVC)
  target_compile_options(tetorica_native_pokey PRIVATE /EHsc)
endif()

# Experimental CPU-free SCSP instrument; no MAME framework or host audio API.
add_library(tetorica_native_scsp STATIC
  "${TETORICA_SDK_ROOT}/vendor/mame-scsp/scsp_instrument.cpp"
  "${TETORICA_SDK_ROOT}/vendor/mame-scsp/scsp.cpp"
  "${TETORICA_SDK_ROOT}/vendor/mame-scsp/scspdsp.cpp"
)
add_library(tetorica::scsp ALIAS tetorica_native_scsp)
target_compile_features(tetorica_native_scsp PUBLIC cxx_std_17)
target_include_directories(tetorica_native_scsp PUBLIC "${CMAKE_CURRENT_LIST_DIR}/include")
if(MSVC)
  target_compile_options(tetorica_native_scsp PRIVATE /EHsc)
else()
  target_compile_options(tetorica_native_scsp PRIVATE -fwrapv -fno-strict-aliasing -ffp-contract=off)
endif()
if(BUILD_TESTING)
  add_executable(tetorica_scsp_fixture tests/scsp_fixture.cpp)
  target_link_libraries(tetorica_scsp_fixture PRIVATE tetorica::scsp)
  add_test(NAME tetorica.scsp.self_test COMMAND tetorica_scsp_fixture --self-test)
endif()

# CPU-free standalone PlayStation SPU instrument. Keep the exact application
# source snapshot and C ABI; no MAME framework, host audio API or generic factory.
add_library(tetorica_native_ps1_spu STATIC
  "${TETORICA_SDK_ROOT}/vendor/mame-ps1-spu/ps1_spu.cpp"
  "${TETORICA_SDK_ROOT}/vendor/mame-ps1-spu/spu.cpp"
  "${TETORICA_SDK_ROOT}/vendor/mame-ps1-spu/spu_tables.cpp"
  "${TETORICA_SDK_ROOT}/vendor/mame-ps1-spu/spureverb.cpp"
)
add_library(tetorica::ps1_spu ALIAS tetorica_native_ps1_spu)
target_compile_features(tetorica_native_ps1_spu PUBLIC cxx_std_17)
target_include_directories(tetorica_native_ps1_spu PUBLIC "${CMAKE_CURRENT_LIST_DIR}/include")
if(MSVC)
  target_compile_options(tetorica_native_ps1_spu PRIVATE /EHsc)
endif()
foreach(flag IN ITEMS -fwrapv -fno-strict-aliasing -ffp-contract=off)
  string(MAKE_C_IDENTIFIER "TETORICA_PS1_SUPPORTS_${flag}" supported_flag)
  check_cxx_compiler_flag("${flag}" "${supported_flag}")
  if(${supported_flag})
    target_compile_options(tetorica_native_ps1_spu PRIVATE "${flag}")
  endif()
endforeach()

if(TETORICA_NATIVE_BUILD_EXAMPLES)
  add_executable(tetorica_ps1_spu_wav examples/ps1_spu_wav.cpp)
  target_link_libraries(tetorica_ps1_spu_wav PRIVATE tetorica::ps1_spu)
  if(MSVC)
    target_compile_options(tetorica_ps1_spu_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_pcengine_cd_wav examples/pcengine_cd_wav.cpp)
  target_compile_features(tetorica_pcengine_cd_wav PRIVATE cxx_std_14)
  target_link_libraries(tetorica_pcengine_cd_wav PRIVATE
    tetorica::huc6280 tetorica::msm5205 tetorica::cdda)
  if(MSVC)
    target_compile_options(tetorica_pcengine_cd_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_pokey_wav examples/pokey_wav.cpp)
  target_link_libraries(tetorica_pokey_wav PRIVATE tetorica::pokey)
  if(MSVC)
    target_compile_options(tetorica_pokey_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_wonderswan_wav examples/wonderswan_wav.cpp)
  target_link_libraries(tetorica_wonderswan_wav PRIVATE tetorica::wonderswan)
  if(MSVC)
    target_compile_options(tetorica_wonderswan_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_nuked_genesis_wav examples/nuked_genesis_wav.cpp)
  target_link_libraries(tetorica_nuked_genesis_wav PRIVATE tetorica::nuked_ym2612 tetorica::segapsg)
  if(MSVC)
    target_compile_options(tetorica_nuked_genesis_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_spc_wav examples/spc_wav.cpp)
  target_link_libraries(tetorica_spc_wav PRIVATE tetorica::spc)
  if(MSVC)
    target_compile_options(tetorica_spc_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_snes_wav examples/snes_wav.cpp)
  target_link_libraries(tetorica_snes_wav PRIVATE tetorica::snes)
  if(MSVC)
    target_compile_options(tetorica_snes_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_dx7_wav examples/dx7_wav.cpp)
  target_link_libraries(tetorica_dx7_wav PRIVATE tetorica::dx7)
  if(MSVC)
    target_compile_options(tetorica_dx7_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_genesis_wav examples/genesis_wav.cpp)
  target_link_libraries(tetorica_genesis_wav PRIVATE tetorica::ym2612 tetorica::segapsg)
  if(MSVC)
    target_compile_options(tetorica_genesis_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_master_system_wav examples/master_system_wav.cpp)
  target_link_libraries(tetorica_master_system_wav PRIVATE tetorica::ym2413 tetorica::segapsg)
  if(MSVC)
    target_compile_options(tetorica_master_system_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_msx_wav examples/msx_wav.cpp)
  target_link_libraries(tetorica_msx_wav PRIVATE tetorica::ay8910 tetorica::ym2413)
  if(MSVC)
    target_compile_options(tetorica_msx_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_pc98_ym2203_wav examples/pc98_ym2203_wav.cpp)
  target_link_libraries(tetorica_pc98_ym2203_wav PRIVATE tetorica::ym2203)
  if(MSVC)
    target_compile_options(tetorica_pc98_ym2203_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_dos_opl_wav examples/dos_opl_wav.cpp)
  target_link_libraries(tetorica_dos_opl_wav PRIVATE tetorica::opl)
  if(MSVC)
    target_compile_options(tetorica_dos_opl_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_msx_audio_wav examples/msx_audio_wav.cpp)
  target_link_libraries(tetorica_msx_audio_wav PRIVATE tetorica::y8950 tetorica::ay8910 tetorica::ym2413)
  if(MSVC)
    target_compile_options(tetorica_msx_audio_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_megacd_wav examples/megacd_wav.cpp)
  target_link_libraries(tetorica_megacd_wav PRIVATE tetorica::ym2612 tetorica::segapsg tetorica::rf5c164)
  if(MSVC)
    target_compile_options(tetorica_megacd_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_x68000_wav examples/x68000_wav.cpp)
  target_link_libraries(tetorica_x68000_wav PRIVATE tetorica::ym2151 tetorica::okim6258)
  if(MSVC)
    target_compile_options(tetorica_x68000_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_neogeo_wav examples/neogeo_wav.cpp)
  target_link_libraries(tetorica_neogeo_wav PRIVATE tetorica::ym2610)
  if(MSVC)
    target_compile_options(tetorica_neogeo_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_pc98_ym2608_wav examples/pc98_ym2608_wav.cpp)
  target_link_libraries(tetorica_pc98_ym2608_wav PRIVATE tetorica::ym2608)
  if(MSVC)
    target_compile_options(tetorica_pc98_ym2608_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_gameboy_wav examples/gameboy_wav.cpp)
  target_link_libraries(tetorica_gameboy_wav PRIVATE tetorica::gameboy)
  if(MSVC)
    target_compile_options(tetorica_gameboy_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_pcengine_wav examples/pcengine_wav.cpp)
  target_link_libraries(tetorica_pcengine_wav PRIVATE tetorica::huc6280)
  if(MSVC)
    target_compile_options(tetorica_pcengine_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_32x_wav examples/sega32x_wav.cpp)
  target_link_libraries(tetorica_32x_wav PRIVATE tetorica::pwm tetorica::ym2612 tetorica::segapsg)
  if(MSVC)
    target_compile_options(tetorica_32x_wav PRIVATE /EHsc)
  endif()
  add_executable(tetorica_nes_fds_wav examples/nes_fds_wav.cpp)
  target_link_libraries(tetorica_nes_fds_wav PRIVATE tetorica::nes)
  if(MSVC)
    target_compile_options(tetorica_nes_fds_wav PRIVATE /EHsc)
  endif()
endif()

if(TETORICA_NATIVE_BUILD_TESTS)
  add_executable(tetorica_ps1_spu_fixture tests/ps1_spu_fixture.cpp)
  target_link_libraries(tetorica_ps1_spu_fixture PRIVATE tetorica::ps1_spu)
  if(MSVC)
    target_compile_options(tetorica_ps1_spu_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ps1_spu_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ps1_spu.self_test COMMAND tetorica_ps1_spu_fixture --self-test)
  add_executable(tetorica_cdda_fixture tests/cdda_fixture.c)
  target_link_libraries(tetorica_cdda_fixture PRIVATE tetorica::cdda)
  add_executable(tetorica_msm5205_fixture tests/msm5205_fixture.c)
  target_link_libraries(tetorica_msm5205_fixture PRIVATE tetorica::msm5205)
  add_executable(tetorica_pce_cd_fixture tests/pce_cd_fixture.cpp)
  target_compile_features(tetorica_pce_cd_fixture PRIVATE cxx_std_14)
  target_link_libraries(tetorica_pce_cd_fixture PRIVATE
    tetorica::huc6280 tetorica::msm5205 tetorica::cdda)
  foreach(fixture IN ITEMS cdda msm5205 pce_cd)
    if(MSVC)
      target_compile_options(tetorica_${fixture}_fixture PRIVATE /UNDEBUG)
    else()
      target_compile_options(tetorica_${fixture}_fixture PRIVATE -UNDEBUG)
    endif()
    add_test(NAME tetorica.${fixture}.self_test COMMAND tetorica_${fixture}_fixture)
  endforeach()
  if(MSVC)
    target_compile_options(tetorica_pce_cd_fixture PRIVATE /EHsc)
  endif()
  add_executable(tetorica_pokey_fixture tests/pokey_fixture.cpp)
  target_link_libraries(tetorica_pokey_fixture PRIVATE tetorica::pokey)
  if(MSVC)
    target_compile_options(tetorica_pokey_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_pokey_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.pokey.self_test
    COMMAND tetorica_pokey_fixture --self-test)
  add_executable(tetorica_wonderswan_fixture tests/wonderswan_fixture.cpp)
  target_link_libraries(tetorica_wonderswan_fixture PRIVATE tetorica::wonderswan)
  if(MSVC)
    target_compile_options(tetorica_wonderswan_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_wonderswan_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.wonderswan.self_test
    COMMAND tetorica_wonderswan_fixture --self-test)

  # Instrument only a test copy of the wrapper. Its symbols satisfy the
  # fixture before the production archive is searched, so the archive supplies
  # only its C provider. Production libraries never reference audit hooks.
  add_library(tetorica_nuked_audit OBJECT tests/nuked_audit.cpp)
  target_compile_features(tetorica_nuked_audit PRIVATE cxx_std_14)
  target_compile_definitions(tetorica_nuked_audit PRIVATE TETORICA_NUKED_AUDIT_ALLOCATIONS)
  target_include_directories(tetorica_nuked_audit PRIVATE
    "${TETORICA_SDK_ROOT}/vendor/nuked-opn2" "${TETORICA_SDK_ROOT}/wasm")
  add_executable(tetorica_nuked_ym2612_fixture tests/nuked_ym2612_fixture.cpp
    $<TARGET_OBJECTS:tetorica_nuked_audit>)
  target_link_libraries(tetorica_nuked_ym2612_fixture PRIVATE tetorica::nuked_ym2612)
  add_executable(tetorica_nuked_colink_fixture tests/nuked_colink_fixture.cpp)
  target_link_libraries(tetorica_nuked_colink_fixture PRIVATE
    tetorica::ym2612 tetorica::nuked_ym2612 tetorica::segapsg Threads::Threads)
  if(MSVC)
    target_compile_options(tetorica_nuked_audit PRIVATE /EHsc)
    target_compile_options(tetorica_nuked_ym2612_fixture PRIVATE /UNDEBUG /EHsc)
    target_compile_options(tetorica_nuked_colink_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_nuked_ym2612_fixture PRIVATE -UNDEBUG)
    target_compile_options(tetorica_nuked_colink_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.nuked_ym2612.self_test
    COMMAND tetorica_nuked_ym2612_fixture --self-test)
  add_test(NAME tetorica.nuked_colink.self_test
    COMMAND tetorica_nuked_colink_fixture)

  # A Release configuration must execute the fixture's assertions as well.
  enable_testing()
  add_executable(tetorica_spc_fixture tests/spc_fixture.cpp)
  target_link_libraries(tetorica_spc_fixture PRIVATE tetorica::spc)
  if(MSVC)
    target_compile_options(tetorica_spc_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_spc_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.spc.self_test
    COMMAND tetorica_spc_fixture --self-test)

  add_executable(tetorica_snes_fixture tests/snes_fixture.cpp)
  target_link_libraries(tetorica_snes_fixture PRIVATE tetorica::snes)
  if(MSVC)
    target_compile_options(tetorica_snes_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_snes_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.snes.self_test
    COMMAND tetorica_snes_fixture --self-test)
  add_test(NAME tetorica.snes.extra_self_test
    COMMAND tetorica_snes_fixture --self-test-extra)

  add_executable(tetorica_dx7_fixture tests/dx7_fixture.cpp)
  target_link_libraries(tetorica_dx7_fixture PRIVATE tetorica::dx7)
  if(MSVC)
    target_compile_options(tetorica_dx7_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_dx7_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.dx7.self_test
    COMMAND tetorica_dx7_fixture --self-test)

  add_executable(tetorica_ym2612_fixture tests/ym2612_fixture.cpp)
  target_link_libraries(tetorica_ym2612_fixture PRIVATE tetorica::ym2612)
  if(MSVC)
    target_compile_options(tetorica_ym2612_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ym2612_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ym2612.self_test
    COMMAND tetorica_ym2612_fixture --self-test)

  add_executable(tetorica_ym2151_fixture tests/ym2151_fixture.cpp)
  target_link_libraries(tetorica_ym2151_fixture PRIVATE tetorica::ym2151)
  if(MSVC)
    target_compile_options(tetorica_ym2151_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ym2151_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ym2151.self_test
    COMMAND tetorica_ym2151_fixture --self-test)

  add_executable(tetorica_segapsg_fixture tests/segapsg_fixture.cpp)
  target_link_libraries(tetorica_segapsg_fixture PRIVATE tetorica::segapsg)
  if(MSVC)
    target_compile_options(tetorica_segapsg_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_segapsg_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.segapsg.self_test
    COMMAND tetorica_segapsg_fixture --self-test)

  add_executable(tetorica_ym2413_fixture tests/ym2413_fixture.cpp)
  target_link_libraries(tetorica_ym2413_fixture PRIVATE tetorica::ym2413)
  if(MSVC)
    target_compile_options(tetorica_ym2413_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ym2413_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ym2413.self_test
    COMMAND tetorica_ym2413_fixture --self-test)

  add_executable(tetorica_ay8910_fixture tests/ay8910_fixture.cpp)
  target_link_libraries(tetorica_ay8910_fixture PRIVATE tetorica::ay8910)
  if(MSVC)
    target_compile_options(tetorica_ay8910_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ay8910_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ay8910.self_test
    COMMAND tetorica_ay8910_fixture --self-test)

  add_executable(tetorica_ym2203_fixture tests/ym2203_fixture.cpp)
  target_link_libraries(tetorica_ym2203_fixture PRIVATE tetorica::ym2203)
  if(MSVC)
    target_compile_options(tetorica_ym2203_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ym2203_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ym2203.self_test
    COMMAND tetorica_ym2203_fixture --self-test)

  add_executable(tetorica_ym2608_fixture tests/ym2608_fixture.cpp)
  target_link_libraries(tetorica_ym2608_fixture PRIVATE tetorica::ym2608)
  if(MSVC)
    target_compile_options(tetorica_ym2608_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ym2608_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ym2608.self_test
    COMMAND tetorica_ym2608_fixture --self-test)
  add_executable(tetorica_ym2610_fixture tests/ym2610_fixture.cpp)
  target_link_libraries(tetorica_ym2610_fixture PRIVATE tetorica::ym2610)
  if(MSVC)
    target_compile_options(tetorica_ym2610_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_ym2610_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.ym2610.self_test
    COMMAND tetorica_ym2610_fixture --self-test)
  add_executable(tetorica_okim6258_fixture tests/okim6258_fixture.cpp)
  target_link_libraries(tetorica_okim6258_fixture PRIVATE tetorica::okim6258)
  if(MSVC)
    target_compile_options(tetorica_okim6258_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_okim6258_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.okim6258.self_test
    COMMAND tetorica_okim6258_fixture --self-test)
  add_executable(tetorica_rf5c164_fixture tests/rf5c164_fixture.cpp)
  target_link_libraries(tetorica_rf5c164_fixture PRIVATE tetorica::rf5c164)
  if(MSVC)
    target_compile_options(tetorica_rf5c164_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_rf5c164_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.rf5c164.self_test
    COMMAND tetorica_rf5c164_fixture --self-test)
  add_executable(tetorica_opl_fixture tests/opl_fixture.cpp)
  target_link_libraries(tetorica_opl_fixture PRIVATE tetorica::opl)
  if(MSVC)
    target_compile_options(tetorica_opl_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_opl_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.opl.self_test
    COMMAND tetorica_opl_fixture --self-test)
  add_executable(tetorica_extra_opl_fixture tests/extra_opl_fixture.cpp)
  target_link_libraries(tetorica_extra_opl_fixture PRIVATE tetorica::opl)
  if(MSVC)
    target_compile_options(tetorica_extra_opl_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_extra_opl_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.extra_opl.self_test
    COMMAND tetorica_extra_opl_fixture --self-test)
  add_executable(tetorica_y8950_memory_fixture tests/y8950_memory_fixture.cpp)
  target_link_libraries(tetorica_y8950_memory_fixture PRIVATE tetorica::y8950)
  if(MSVC)
    target_compile_options(tetorica_y8950_memory_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_y8950_memory_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.y8950_memory.self_test
    COMMAND tetorica_y8950_memory_fixture --self-test)
  add_executable(tetorica_gameboy_fixture tests/gameboy_fixture.cpp)
  target_link_libraries(tetorica_gameboy_fixture PRIVATE tetorica::gameboy)
  if(MSVC)
    target_compile_options(tetorica_gameboy_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_gameboy_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.gameboy.self_test
    COMMAND tetorica_gameboy_fixture --self-test)
  add_executable(tetorica_huc6280_fixture tests/huc6280_fixture.cpp)
  target_link_libraries(tetorica_huc6280_fixture PRIVATE tetorica::huc6280)
  if(MSVC)
    target_compile_options(tetorica_huc6280_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_huc6280_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.huc6280.self_test
    COMMAND tetorica_huc6280_fixture --self-test)
  add_executable(tetorica_pwm_fixture tests/pwm_fixture.cpp)
  target_link_libraries(tetorica_pwm_fixture PRIVATE tetorica::pwm)
  if(MSVC)
    target_compile_options(tetorica_pwm_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_pwm_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.pwm.self_test
    COMMAND tetorica_pwm_fixture --self-test)
  add_executable(tetorica_extra_pwm_fixture tests/extra_pwm_fixture.cpp)
  target_link_libraries(tetorica_extra_pwm_fixture PRIVATE tetorica::pwm)
  target_include_directories(tetorica_extra_pwm_fixture PRIVATE "${TETORICA_SDK_ROOT}/wasm")
  if(MSVC)
    target_compile_options(tetorica_extra_pwm_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_extra_pwm_fixture PRIVATE -UNDEBUG)
  endif()
  # Its --core CLI exercises the same header-only core as the wrapper.
  if(TETORICA_PWM_SUPPORTS_NO_FP_CONTRACT)
    target_compile_options(tetorica_extra_pwm_fixture PRIVATE -ffp-contract=off)
  endif()
  add_test(NAME tetorica.extra_pwm.self_test
    COMMAND tetorica_extra_pwm_fixture --self-test)
  add_executable(tetorica_nes_fixture tests/nes_fixture.cpp)
  target_link_libraries(tetorica_nes_fixture PRIVATE tetorica::nes)
  if(MSVC)
    target_compile_options(tetorica_nes_fixture PRIVATE /UNDEBUG /EHsc)
  else()
    target_compile_options(tetorica_nes_fixture PRIVATE -UNDEBUG)
  endif()
  add_test(NAME tetorica.nes.self_test
    COMMAND tetorica_nes_fixture --self-test)
endif()
