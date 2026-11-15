cmake_minimum_required(VERSION 3.20)

project(ssfplay VERSION 0.1.0 LANGUAGES C CXX)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)
include(CTest)
include(CheckIncludeFile)
include(CheckSymbolExists)
include(CheckTypeSize)

option(SSFPLAY_BUILD_SHARED "Build shared ssfplay library" OFF)
option(SSFPLAY_BUILD_CLI "Build ssfplay_cli, ssf2wav, and ssf2vgm tools" ON)
option(SSFPLAY_BUILD_PLAYER "Build ssfplay_cli playback tool" ON)
option(SSFPLAY_TOOLS_STATIC_RUNTIME "Use the static MSVC runtime for command-line tools" ON)
option(SSFPLAY_BUILD_WASM "Build the Emscripten/WASM wrapper" OFF)
option(SSFPLAY_BUILD_FOOBAR2000 "Build the foobar2000 component when an SDK is available" OFF)
option(SSFPLAY_BUILD_LIBVGM_AB_PLAYER "Build old/new libvgm A/B slot comparison player" ON)
set(FB2K_SDK_DIR "" CACHE PATH "Path to the foobar2000 SDK")

if(EMSCRIPTEN)
  add_library(ZLIB::ZLIB INTERFACE IMPORTED)
  target_compile_options(ZLIB::ZLIB INTERFACE "SHELL:-sUSE_ZLIB=1")
  target_link_options(ZLIB::ZLIB INTERFACE "SHELL:-sUSE_ZLIB=1")
  set(HAVE_ICONV 0)
  set(SSFPLAY_CONFIG_FIND_ZLIB "")
  set(SSFPLAY_CONFIG_FIND_ICONV "")
else()
  find_package(ZLIB REQUIRED)
  find_package(Iconv REQUIRED)
  set(HAVE_ICONV 1)
  set(SSFPLAY_CONFIG_FIND_ZLIB "find_dependency(ZLIB)")
  set(SSFPLAY_CONFIG_FIND_ICONV "find_dependency(Iconv)")
endif()
if(UNIX AND NOT APPLE AND NOT EMSCRIPTEN)
  find_package(ALSA)
endif()

set(MEDNAFEN_DIR "${CMAKE_CURRENT_SOURCE_DIR}/mednafen")
set(MEDNAFEN_SRC "${MEDNAFEN_DIR}/src")

if(EMSCRIPTEN)
  set(HAVE_INTTYPES_H 1)
  set(HAVE_LIMITS_H 1)
  set(HAVE_STDINT_H 1)
  set(HAVE_STDLIB_H 1)
  set(HAVE_STRING_H 1)
  set(HAVE_SYS_STAT_H 1)
  set(HAVE_SYS_TYPES_H 1)
  set(HAVE_UNISTD_H 1)
  set(HAVE_SIGLONGJMP 0)
  set(HAVE__LONGJMP 0)
  set(SIZEOF_CHAR 1)
  set(SIZEOF_SHORT 2)
  set(SIZEOF_INT 4)
  set(SIZEOF_LONG 4)
  set(SIZEOF_LONG_LONG 8)
  set(SIZEOF_OFF_T 8)
  set(SIZEOF_PTRDIFF_T 4)
  set(SIZEOF_SIZE_T 4)
  set(SIZEOF_VOID_P 4)
else()
  check_include_file("inttypes.h" HAVE_INTTYPES_H)
  check_include_file("limits.h" HAVE_LIMITS_H)
  check_include_file("stdint.h" HAVE_STDINT_H)
  check_include_file("stdlib.h" HAVE_STDLIB_H)
  check_include_file("string.h" HAVE_STRING_H)
  check_include_file("sys/stat.h" HAVE_SYS_STAT_H)
  check_include_file("sys/types.h" HAVE_SYS_TYPES_H)
  check_include_file("unistd.h" HAVE_UNISTD_H)
  check_symbol_exists(siglongjmp "setjmp.h" HAVE_SIGLONGJMP)
  check_symbol_exists(_longjmp "setjmp.h" HAVE__LONGJMP)
  check_type_size("char" SIZEOF_CHAR LANGUAGE CXX)
  check_type_size("short" SIZEOF_SHORT LANGUAGE CXX)
  check_type_size("int" SIZEOF_INT LANGUAGE CXX)
  check_type_size("long" SIZEOF_LONG LANGUAGE CXX)
  check_type_size("long long" SIZEOF_LONG_LONG LANGUAGE CXX)
  check_type_size("off_t" SIZEOF_OFF_T LANGUAGE CXX)
  check_type_size("ptrdiff_t" SIZEOF_PTRDIFF_T LANGUAGE CXX)
  check_type_size("size_t" SIZEOF_SIZE_T LANGUAGE CXX)
  set(SIZEOF_VOID_P "${CMAKE_SIZEOF_VOID_P}")
endif()

configure_file(cmake/config.h.in "${CMAKE_CURRENT_BINARY_DIR}/generated/config.h")
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/generated/trio")
file(COPY
  "${MEDNAFEN_SRC}/trio/trio.h"
  "${MEDNAFEN_SRC}/trio/triodef.h"
  "${MEDNAFEN_SRC}/trio/trionan.h"
  "${MEDNAFEN_SRC}/trio/triop.h"
  "${MEDNAFEN_SRC}/trio/triostr.h"
  DESTINATION "${CMAKE_CURRENT_BINARY_DIR}/generated/trio"
)

set(SSFPLAY_SOURCES
  src/ssfplay.cpp
  src/mednafen_compat.cpp
  ${MEDNAFEN_SRC}/error.cpp
  ${MEDNAFEN_SRC}/Stream.cpp
  ${MEDNAFEN_SRC}/MemoryStream.cpp
  ${MEDNAFEN_SRC}/FileStream.cpp
  ${MEDNAFEN_SRC}/VirtualFS.cpp
  ${MEDNAFEN_SRC}/PSFLoader.cpp
  ${MEDNAFEN_SRC}/SSFLoader.cpp
  ${MEDNAFEN_SRC}/compress/DecompressFilter.cpp
  ${MEDNAFEN_SRC}/compress/ZLInflateFilter.cpp
  ${MEDNAFEN_SRC}/string/string.cpp
  ${MEDNAFEN_SRC}/hw_cpu/m68k/m68k.cpp
  ${MEDNAFEN_SRC}/resampler/resample.c
  ${MEDNAFEN_SRC}/trio/trio.c
  ${MEDNAFEN_SRC}/trio/trionan.c
  ${MEDNAFEN_SRC}/trio/triostr.c
)

if(WIN32)
  list(APPEND SSFPLAY_SOURCES
    ${MEDNAFEN_SRC}/win32-common.cpp
  )
endif()

if(SSFPLAY_BUILD_SHARED)
  add_library(ssfplay SHARED ${SSFPLAY_SOURCES})
else()
  add_library(ssfplay STATIC ${SSFPLAY_SOURCES})
endif()
add_library(ssfplay::ssfplay ALIAS ssfplay)

target_compile_features(ssfplay PRIVATE cxx_std_11)
target_compile_definitions(ssfplay PRIVATE
  HAVE_CONFIG_H=1
  MDFN_DISABLE_PICPIE_ERRWARN=1
  MDFN_DISABLE_NO_OPT_ERRWARN=1
)
if(SSFPLAY_BUILD_SHARED)
  target_compile_definitions(ssfplay PRIVATE SSFPLAY_BUILDING=1)
else()
  target_compile_definitions(ssfplay PUBLIC SSFPLAY_STATIC=1)
endif()
target_compile_options(ssfplay PRIVATE
  $<$<COMPILE_LANGUAGE:C>:-fsigned-char;-fwrapv;-fno-fast-math>
  $<$<COMPILE_LANGUAGE:CXX>:-fsigned-char;-fwrapv;-fno-fast-math;-fexceptions>
)
target_include_directories(ssfplay
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
  PRIVATE
    "${CMAKE_CURRENT_BINARY_DIR}/generated"
    "${MEDNAFEN_DIR}/include"
)
target_link_libraries(ssfplay PRIVATE ZLIB::ZLIB)
if(HAVE_ICONV)
  target_link_libraries(ssfplay PRIVATE Iconv::Iconv)
endif()
if(MSVC AND SSFPLAY_TOOLS_STATIC_RUNTIME)
  set_property(TARGET ssfplay PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
set_target_properties(ssfplay PROPERTIES
  C_VISIBILITY_PRESET hidden
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN YES
  VERSION "${PROJECT_VERSION}"
  SOVERSION "${PROJECT_VERSION_MAJOR}"
)

function(ssfplay_configure_tool target)
  target_link_libraries(${target} PRIVATE ssfplay::ssfplay)
  if(MSVC AND SSFPLAY_TOOLS_STATIC_RUNTIME)
    set_property(TARGET ${target} PROPERTY
      MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  endif()
  if(APPLE)
    set_target_properties(${target} PROPERTIES INSTALL_RPATH "@loader_path/../${CMAKE_INSTALL_LIBDIR}")
  elseif(UNIX)
    set_target_properties(${target} PROPERTIES INSTALL_RPATH "$ORIGIN/../${CMAKE_INSTALL_LIBDIR}")
  endif()
endfunction()

set(SSFPLAY_TOOL_TARGETS)
if(SSFPLAY_BUILD_CLI)
  add_executable(ssf2wav tools/ssf2wav.c)
  ssfplay_configure_tool(ssf2wav)
  list(APPEND SSFPLAY_TOOL_TARGETS ssf2wav)

  add_executable(ssf2vgm tools/ssf2vgm.cpp)
  target_compile_features(ssf2vgm PRIVATE cxx_std_11)
  ssfplay_configure_tool(ssf2vgm)
  target_link_libraries(ssf2vgm PRIVATE ZLIB::ZLIB)
  list(APPEND SSFPLAY_TOOL_TARGETS ssf2vgm)

  add_executable(ssf_sample_dump tools/ssf_sample_dump.cpp)
  target_compile_features(ssf_sample_dump PRIVATE cxx_std_11)
  ssfplay_configure_tool(ssf_sample_dump)
  list(APPEND SSFPLAY_TOOL_TARGETS ssf_sample_dump)

  add_executable(scsp_dsp_trace tools/scsp_dsp_trace.cpp)
  target_compile_features(scsp_dsp_trace PRIVATE cxx_std_11)
  ssfplay_configure_tool(scsp_dsp_trace)
  target_link_libraries(scsp_dsp_trace PRIVATE ZLIB::ZLIB)
  list(APPEND SSFPLAY_TOOL_TARGETS scsp_dsp_trace)

  add_executable(mednafen_scsp_slot_dump tools/mednafen_scsp_slot_dump.cpp)
  target_compile_features(mednafen_scsp_slot_dump PRIVATE cxx_std_17)
  ssfplay_configure_tool(mednafen_scsp_slot_dump)
  target_link_libraries(mednafen_scsp_slot_dump PRIVATE ZLIB::ZLIB)
  list(APPEND SSFPLAY_TOOL_TARGETS mednafen_scsp_slot_dump)

  add_executable(compare_slot_wavs tools/compare_slot_wavs.cpp)
  target_compile_features(compare_slot_wavs PRIVATE cxx_std_17)
  list(APPEND SSFPLAY_TOOL_TARGETS compare_slot_wavs)

  add_executable(scsp_slot_trace_summary tools/scsp_slot_trace_summary.cpp)
  target_compile_features(scsp_slot_trace_summary PRIVATE cxx_std_11)
  list(APPEND SSFPLAY_TOOL_TARGETS scsp_slot_trace_summary)

  if(SSFPLAY_BUILD_LIBVGM_AB_PLAYER AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/libvgm/CMakeLists.txt")
    set(BUILD_LIBAUDIO OFF CACHE BOOL "" FORCE)
    set(BUILD_LIBEMU ON CACHE BOOL "" FORCE)
    set(BUILD_LIBPLAYER ON CACHE BOOL "" FORCE)
    set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(BUILD_PLAYER OFF CACHE BOOL "" FORCE)
    set(BUILD_VGM2WAV OFF CACHE BOOL "" FORCE)
    set(USE_SANITIZERS OFF CACHE BOOL "" FORCE)
    add_subdirectory(libvgm "${CMAKE_CURRENT_BINARY_DIR}/libvgm-current" EXCLUDE_FROM_ALL)

    add_executable(libvgm_ab_worker_new tools/libvgm_ab_worker.cpp)
    target_compile_features(libvgm_ab_worker_new PRIVATE cxx_std_11)
    target_include_directories(libvgm_ab_worker_new PRIVATE
      "${CMAKE_CURRENT_SOURCE_DIR}/tools"
      "${CMAKE_CURRENT_SOURCE_DIR}/libvgm")
    target_link_libraries(libvgm_ab_worker_new PRIVATE vgm-player vgm-emu vgm-utils)

    set(LIBVGM_AB_OLD_SRC "${CMAKE_CURRENT_BINARY_DIR}/libvgm-old-src")
    set(LIBVGM_AB_OLD_BUILD "${CMAKE_CURRENT_BINARY_DIR}/libvgm-old-build")
    set(LIBVGM_AB_OLD_TAR "${CMAKE_CURRENT_BINARY_DIR}/libvgm-old.tar")
    set(LIBVGM_AB_OLD_WORKER_PATH "${LIBVGM_AB_OLD_BUILD}/bin/libvgm_ab_worker_old${CMAKE_EXECUTABLE_SUFFIX}")
    if(NOT EXISTS "${LIBVGM_AB_OLD_SRC}/CMakeLists.txt")
      file(MAKE_DIRECTORY "${LIBVGM_AB_OLD_SRC}")
      execute_process(
        COMMAND git -C "${CMAKE_CURRENT_SOURCE_DIR}/libvgm" archive --format=tar "--output=${LIBVGM_AB_OLD_TAR}" HEAD
        RESULT_VARIABLE LIBVGM_AB_ARCHIVE_RESULT)
      if(NOT LIBVGM_AB_ARCHIVE_RESULT EQUAL 0)
        message(FATAL_ERROR "Could not archive old libvgm HEAD")
      endif()
      execute_process(
        COMMAND "${CMAKE_COMMAND}" -E tar xf "${LIBVGM_AB_OLD_TAR}"
        WORKING_DIRECTORY "${LIBVGM_AB_OLD_SRC}"
        RESULT_VARIABLE LIBVGM_AB_EXTRACT_RESULT)
      if(NOT LIBVGM_AB_EXTRACT_RESULT EQUAL 0)
        message(FATAL_ERROR "Could not extract old libvgm HEAD")
      endif()

      file(READ "${LIBVGM_AB_OLD_SRC}/emu/cores/scsp.c" LIBVGM_AB_OLD_SCSP)
      string(REPLACE
        "static UINT8 BypassDSP = 0x01;"
        "static UINT8 BypassDSP = 0x01;\n\
typedef void (*SCSP_SLOT_SAMPLE_CALLBACK)(void* opaque, UINT32 slot, INT32 sample);\n\
static SCSP_SLOT_SAMPLE_CALLBACK SlotSampleCallback = NULL;\n\
static void* SlotSampleCallbackOpaque = NULL;\n\
typedef void (*SCSP_SLOT_KEYON_CALLBACK)(void* opaque, UINT32 slot, UINT32 sample_address, UINT32 pitch);\n\
static SCSP_SLOT_KEYON_CALLBACK SlotKeyOnCallback = NULL;\n\
static void* SlotKeyOnCallbackOpaque = NULL;\n\
static UINT32 DebugOutputMuteMask = 0;\n\
\n\
void libvgm_scsp_set_slot_sample_callback(SCSP_SLOT_SAMPLE_CALLBACK callback, void* opaque)\n\
{\n\
\tSlotSampleCallback = callback;\n\
\tSlotSampleCallbackOpaque = opaque;\n\
}\n\
\n\
void libvgm_scsp_set_slot_keyon_callback(SCSP_SLOT_KEYON_CALLBACK callback, void* opaque)\n\
{\n\
\tSlotKeyOnCallback = callback;\n\
\tSlotKeyOnCallbackOpaque = opaque;\n\
}\n\
\n\
void libvgm_scsp_set_debug_output_mute_mask(UINT32 mute_mask)\n\
{\n\
\tDebugOutputMuteMask = mute_mask;\n\
}"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "Compute_LFO(slot);\n\n//\tprintf(\"StartSlot[%p]: SA %x PCM8B %x LPCTL %x ALFOS %x STWINH %x TL %x EFSDL %x\\n\", slot, SA(slot), PCM8B(slot), LPCTL(slot), ALFOS(slot), STWINH(slot), TL(slot), EFSDL(slot));"
        "Compute_LFO(slot);\n\tif(SlotKeyOnCallback != NULL)\n\t\tSlotKeyOnCallback(SlotKeyOnCallbackOpaque, (UINT32)slot->slot, SA(slot), (UINT32)(((OCT(slot) & 0xF) << 10) | FNS(slot)));\n\n//\tprintf(\"StartSlot[%p]: SA %x PCM8B %x LPCTL %x ALFOS %x STWINH %x TL %x EFSDL %x\\n\", slot, SA(slot), PCM8B(slot), LPCTL(slot), ALFOS(slot), STWINH(slot), TL(slot), EFSDL(slot));"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "for(sl=0;sl<32;++sl)\n\t\t{"
        "for(sl=0;sl<32;++sl)\n\t\t{\n\t\t\tsigned int callbackSample = 0;"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "signed int sample;"
        "signed int sample;\n\t\t\t\tsigned int slotLeft;\n\t\t\t\tsigned int slotRight;\n\t\t\t\tUINT8 debugOutputMuted;"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "sample=SCSP_UpdateSlot(scsp, slot);"
        "sample=SCSP_UpdateSlot(scsp, slot);\n\t\t\t\tdebugOutputMuted = (DebugOutputMuteMask >> sl) & 1;"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "if (! BypassDSP)\n\t\t\t\t{"
        "if (!debugOutputMuted && ! BypassDSP)\n\t\t\t\t{"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "if (! BypassDSP)\n\t\t{"
        "if (! BypassDSP && DebugOutputMuteMask == 0)\n\t\t{"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "BypassDSP = (Flags & 0x01) >> 0;\n\t\n\treturn;"
        "BypassDSP = (Flags & 0x01) >> 0;\n\tif (getenv(\"LIBVGM_SCSP_FORCE_DSP\") != NULL)\n\t\tBypassDSP = 0x00;\n\t\n\treturn;"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "SCSP_Init(scsp, cfg->clock);\n\n\tscsp_set_mute_mask(scsp, 0x00000000);"
        "SCSP_Init(scsp, cfg->clock);\n\tif (getenv(\"LIBVGM_SCSP_FORCE_DSP\") != NULL)\n\t\tBypassDSP = 0x00;\n\n\tscsp_set_mute_mask(scsp, 0x00000000);"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "smpl+=(sample*scsp->LPANTABLE[Enc])>>SHIFT;\n\t\t\t\t\tsmpr+=(sample*scsp->RPANTABLE[Enc])>>SHIFT;"
        "slotLeft=(sample*scsp->LPANTABLE[Enc])>>SHIFT;\n\t\t\t\t\tslotRight=(sample*scsp->RPANTABLE[Enc])>>SHIFT;\n\t\t\t\t\tsmpl+=slotLeft;\n\t\t\t\t\tsmpr+=slotRight;\n\t\t\t\t\tcallbackSample=(slotLeft+slotRight)/2;"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "Enc=((TL(slot))<<0x0)|((DIPAN(slot))<<0x8)|((DISDL(slot))<<0xd);\n\t\t\t\t{\n\t\t\t\t\tslotLeft="
        "if(!debugOutputMuted)\n\t\t\t\t{\n\t\t\t\t\tEnc=((TL(slot))<<0x0)|((DIPAN(slot))<<0x8)|((DISDL(slot))<<0xd);\n\t\t\t\t\t{\n\t\t\t\t\t\tslotLeft="
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "callbackSample=(slotLeft+slotRight)/2;\n\t\t\t\t}"
        "callbackSample=(slotLeft+slotRight)/2;\n\t\t\t\t\t}\n\t\t\t\t}"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      string(REPLACE
        "#if FM_DELAY\n\t\t\tscsp->RINGBUF[(scsp->BUFPTR+64-(FM_DELAY-1))&63] = scsp->DELAYBUF[(scsp->DELAYPTR+FM_DELAY-(FM_DELAY-1))%FM_DELAY];\n#endif"
        "if(SlotSampleCallback != NULL)\n\t\t\t\tSlotSampleCallback(SlotSampleCallbackOpaque, sl, callbackSample);\n#if FM_DELAY\n\t\t\tscsp->RINGBUF[(scsp->BUFPTR+64-(FM_DELAY-1))&63] = scsp->DELAYBUF[(scsp->DELAYPTR+FM_DELAY-(FM_DELAY-1))%FM_DELAY];\n#endif"
        LIBVGM_AB_OLD_SCSP "${LIBVGM_AB_OLD_SCSP}")
      file(WRITE "${LIBVGM_AB_OLD_SRC}/emu/cores/scsp.c" "${LIBVGM_AB_OLD_SCSP}")
      file(COPY
        "${CMAKE_CURRENT_SOURCE_DIR}/tools/libvgm_ab_worker.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/tools/libvgm_ab_slot_callback.h"
        DESTINATION "${LIBVGM_AB_OLD_SRC}")
      file(APPEND "${LIBVGM_AB_OLD_SRC}/CMakeLists.txt" "\n\
add_executable(libvgm_ab_worker_old libvgm_ab_worker.cpp)\n\
target_compile_features(libvgm_ab_worker_old PRIVATE cxx_std_11)\n\
target_include_directories(libvgm_ab_worker_old PRIVATE \${PROJECT_SOURCE_DIR})\n\
target_link_libraries(libvgm_ab_worker_old PRIVATE vgm-player vgm-emu vgm-utils)\n")
    endif()

    add_custom_command(
      OUTPUT "${LIBVGM_AB_OLD_WORKER_PATH}"
      COMMAND "${CMAKE_COMMAND}" -S "${LIBVGM_AB_OLD_SRC}" -B "${LIBVGM_AB_OLD_BUILD}"
        -DBUILD_LIBAUDIO=OFF -DBUILD_LIBEMU=ON -DBUILD_LIBPLAYER=ON
        -DBUILD_TESTS=OFF -DBUILD_PLAYER=OFF -DBUILD_VGM2WAV=OFF
        -DUSE_SANITIZERS=OFF -DLIBRARY_TYPE=STATIC
      COMMAND "${CMAKE_COMMAND}" --build "${LIBVGM_AB_OLD_BUILD}" --target libvgm_ab_worker_old
      DEPENDS
        "${LIBVGM_AB_OLD_SRC}/CMakeLists.txt"
        "${LIBVGM_AB_OLD_SRC}/libvgm_ab_worker.cpp"
        "${LIBVGM_AB_OLD_SRC}/libvgm_ab_slot_callback.h"
        "${LIBVGM_AB_OLD_SRC}/emu/cores/scsp.c"
      VERBATIM)
    add_custom_target(libvgm_ab_worker_old_build
      DEPENDS "${LIBVGM_AB_OLD_WORKER_PATH}")

    add_executable(libvgm_ab_player tools/libvgm_ab_player.cpp)
    target_compile_features(libvgm_ab_player PRIVATE cxx_std_11)
    add_dependencies(libvgm_ab_player libvgm_ab_worker_new libvgm_ab_worker_old_build)
    target_compile_definitions(libvgm_ab_player PRIVATE
      LIBVGM_AB_NEW_WORKER="$<TARGET_FILE:libvgm_ab_worker_new>"
      LIBVGM_AB_OLD_WORKER="${LIBVGM_AB_OLD_WORKER_PATH}")
    if(WIN32)
      target_link_libraries(libvgm_ab_player PRIVATE winmm)
    elseif(APPLE)
      target_link_libraries(libvgm_ab_player PRIVATE "-framework AudioToolbox")
    elseif(ALSA_FOUND)
      target_compile_definitions(libvgm_ab_player PRIVATE SSFPLAY_HAVE_ALSA=1)
      target_include_directories(libvgm_ab_player PRIVATE ${ALSA_INCLUDE_DIRS})
      target_link_libraries(libvgm_ab_player PRIVATE ${ALSA_LIBRARIES})
    endif()
    list(APPEND SSFPLAY_TOOL_TARGETS libvgm_ab_worker_new libvgm_ab_player)

    add_executable(ssf_vgm_ab_player tools/ssf_vgm_ab_player.cpp)
    target_compile_features(ssf_vgm_ab_player PRIVATE cxx_std_11)
    ssfplay_configure_tool(ssf_vgm_ab_player)
    add_dependencies(ssf_vgm_ab_player libvgm_ab_worker_old_build)
    target_compile_definitions(ssf_vgm_ab_player PRIVATE
      LIBVGM_AB_OLD_WORKER="${LIBVGM_AB_OLD_WORKER_PATH}")
    if(WIN32)
      target_link_libraries(ssf_vgm_ab_player PRIVATE winmm)
    elseif(APPLE)
      target_link_libraries(ssf_vgm_ab_player PRIVATE "-framework AudioToolbox")
    elseif(ALSA_FOUND)
      target_compile_definitions(ssf_vgm_ab_player PRIVATE SSFPLAY_HAVE_ALSA=1)
      target_include_directories(ssf_vgm_ab_player PRIVATE ${ALSA_INCLUDE_DIRS})
      target_link_libraries(ssf_vgm_ab_player PRIVATE ${ALSA_LIBRARIES})
    endif()
    list(APPEND SSFPLAY_TOOL_TARGETS ssf_vgm_ab_player)
  endif()

  if(SSFPLAY_BUILD_PLAYER)
    add_executable(ssfplay_cli tools/ssfplay_cli.cpp)
    target_compile_features(ssfplay_cli PRIVATE cxx_std_11)
    ssfplay_configure_tool(ssfplay_cli)
    if(WIN32)
      target_link_libraries(ssfplay_cli PRIVATE winmm)
    elseif(APPLE)
      target_link_libraries(ssfplay_cli PRIVATE "-framework AudioToolbox")
    elseif(ALSA_FOUND)
      target_compile_definitions(ssfplay_cli PRIVATE SSFPLAY_HAVE_ALSA=1)
      target_include_directories(ssfplay_cli PRIVATE ${ALSA_INCLUDE_DIRS})
      target_link_libraries(ssfplay_cli PRIVATE ${ALSA_LIBRARIES})
    endif()
    list(APPEND SSFPLAY_TOOL_TARGETS ssfplay_cli)
  endif()

  add_custom_target(ssfplay_all_tools DEPENDS ${SSFPLAY_TOOL_TARGETS})
endif()

if(SSFPLAY_BUILD_WASM)
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "SSFPLAY_BUILD_WASM requires configuring with emcmake/emcc")
  endif()
  add_executable(ssfplay_wasm src/wasm/ssfplay_wasm.cpp)
  target_compile_features(ssfplay_wasm PRIVATE cxx_std_11)
  ssfplay_configure_tool(ssfplay_wasm)
  target_link_libraries(ssfplay_wasm PRIVATE ZLIB::ZLIB)
  target_link_options(ssfplay_wasm PRIVATE
    "SHELL:-sMODULARIZE=1"
    "SHELL:-sEXPORT_NAME=createSSFPlay"
    "SHELL:-sENVIRONMENT=web,worker,node"
    "SHELL:-sALLOW_MEMORY_GROWTH=1"
    "SHELL:-sEXPORTED_FUNCTIONS=['_malloc','_free','_ssfplay_wasm_open','_ssfplay_wasm_render','_ssfplay_wasm_close','_ssfplay_wasm_last_error']"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=['FS','cwrap','ccall','HEAP16','HEAPU8','UTF8ToString','stringToUTF8','lengthBytesUTF8']"
  )
  set_target_properties(ssfplay_wasm PROPERTIES OUTPUT_NAME "ssfplay" SUFFIX ".js")
endif()

if(SSFPLAY_BUILD_FOOBAR2000)
  add_subdirectory(components/foobar2000)
endif()

if(BUILD_TESTING)
  add_executable(ssfplay_tests tests/ssfplay_tests.c)
  target_link_libraries(ssfplay_tests PRIVATE ssfplay::ssfplay)
  add_test(NAME ssfplay_no_fixture_test COMMAND ssfplay_tests)
  set(SSFPLAY_NIGHTS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/Nights Into Dreams (EMU).zophar")
  set(SSFPLAY_NIGHTS_TRACK "${SSFPLAY_NIGHTS_DIR}/25 Twin Seeds - Growing Wings.ssf")
  if(EXISTS "${SSFPLAY_NIGHTS_TRACK}")
    add_test(NAME ssfplay_tests COMMAND ssfplay_tests "${SSFPLAY_NIGHTS_DIR}")
  else()
    message(STATUS "NiGHTS SSF fixture not found; skipping sample-dependent tests")
  endif()
  if(SSFPLAY_BUILD_CLI AND EXISTS "${SSFPLAY_NIGHTS_TRACK}")
    add_test(NAME ssf2wav_test COMMAND "${CMAKE_COMMAND}"
      "-DSSF2WAV=$<TARGET_FILE:ssf2wav>"
      "-DINPUT=${CMAKE_CURRENT_SOURCE_DIR}/Nights Into Dreams (EMU).zophar/25 Twin Seeds - Growing Wings.ssf"
      "-DOUTPUT=${CMAKE_CURRENT_BINARY_DIR}/test.wav"
      -P "${CMAKE_CURRENT_SOURCE_DIR}/tests/check_wav.cmake")
    add_test(NAME ssf2vgm_generate COMMAND ssf2vgm
      --length-ms 1000
      --report "${CMAKE_CURRENT_BINARY_DIR}/test-vgm-report.json"
      "${CMAKE_CURRENT_SOURCE_DIR}/Nights Into Dreams (EMU).zophar/25 Twin Seeds - Growing Wings.ssf"
      "${CMAKE_CURRENT_BINARY_DIR}/test.vgm")
    set_tests_properties(ssf2vgm_generate PROPERTIES FIXTURES_SETUP generated_vgm)
    add_test(NAME ssf2vgm_generate_vgz COMMAND ssf2vgm
      --length-ms 1000
      "${CMAKE_CURRENT_SOURCE_DIR}/Nights Into Dreams (EMU).zophar/25 Twin Seeds - Growing Wings.ssf"
      "${CMAKE_CURRENT_BINARY_DIR}/test.vgz")
    add_test(NAME ssf_sample_dump_test COMMAND ssf_sample_dump
      --capture-ms 1000
      --max-dumps 4
      "${CMAKE_CURRENT_SOURCE_DIR}/Nights Into Dreams (EMU).zophar/01 Spring Valley - Paternal Horn [Ecstatic].ssf"
      "${CMAKE_CURRENT_BINARY_DIR}/sample-dump-test")
    add_executable(vgm_replay_tests tests/vgm_replay_tests.cpp)
    target_compile_features(vgm_replay_tests PRIVATE cxx_std_11)
    target_link_libraries(vgm_replay_tests PRIVATE ssfplay::ssfplay)
    add_test(NAME vgm_replay_tests COMMAND vgm_replay_tests
      "${CMAKE_CURRENT_SOURCE_DIR}/Nights Into Dreams (EMU).zophar/25 Twin Seeds - Growing Wings.ssf"
      "${CMAKE_CURRENT_BINARY_DIR}/test.vgm")
    set_tests_properties(vgm_replay_tests PROPERTIES FIXTURES_REQUIRED generated_vgm)
    add_test(NAME ssf2vgm_all_tracks COMMAND "${CMAKE_COMMAND}"
      "-DSSF2VGM=$<TARGET_FILE:ssf2vgm>"
      "-DMUSIC_DIR=${CMAKE_CURRENT_SOURCE_DIR}/Nights Into Dreams (EMU).zophar"
      "-DOUTPUT_DIR=${CMAKE_CURRENT_BINARY_DIR}/smoke-test-vgm-1s"
      -P "${CMAKE_CURRENT_SOURCE_DIR}/tests/convert_all_ssf.cmake")
  endif()
endif()

install(TARGETS ssfplay
  EXPORT ssfplayTargets
  LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}" COMPONENT dev
  ARCHIVE DESTINATION "${CMAKE_INSTALL_LIBDIR}" COMPONENT dev
  RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}" COMPONENT dev
)
if(SSFPLAY_BUILD_CLI)
  install(TARGETS ${SSFPLAY_TOOL_TARGETS} RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}" COMPONENT tools)
endif()
install(DIRECTORY include/ DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}" COMPONENT dev)
install(FILES README.md DESTINATION "${CMAKE_INSTALL_DOCDIR}" COMPONENT tools)
install(FILES mednafen/COPYING
  DESTINATION "${CMAKE_INSTALL_DOCDIR}"
  RENAME COPYING.mednafen
  COMPONENT tools
)
install(EXPORT ssfplayTargets
  FILE ssfplayTargets.cmake
  NAMESPACE ssfplay::
  DESTINATION "${CMAKE_INSTALL_LIBDIR}/cmake/ssfplay"
  COMPONENT dev
)
configure_package_config_file(cmake/ssfplayConfig.cmake.in
  "${CMAKE_CURRENT_BINARY_DIR}/ssfplayConfig.cmake"
  INSTALL_DESTINATION "${CMAKE_INSTALL_LIBDIR}/cmake/ssfplay"
)
write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/ssfplayConfigVersion.cmake"
  VERSION "${PROJECT_VERSION}"
  COMPATIBILITY SameMajorVersion
)
install(FILES
  "${CMAKE_CURRENT_BINARY_DIR}/ssfplayConfig.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/ssfplayConfigVersion.cmake"
  DESTINATION "${CMAKE_INSTALL_LIBDIR}/cmake/ssfplay"
  COMPONENT dev
)

set(CPACK_PACKAGE_NAME "ssfplay-tools")
set(CPACK_PACKAGE_VENDOR "ssfplay")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_FILE_NAME "ssfplay-tools-${PROJECT_VERSION}-${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}")
if(WIN32)
  set(CPACK_GENERATOR "ZIP")
else()
  set(CPACK_GENERATOR "TGZ")
endif()
set(CPACK_ARCHIVE_COMPONENT_INSTALL ON)
set(CPACK_COMPONENTS_ALL tools)
set(CPACK_COMPONENT_TOOLS_DISPLAY_NAME "ssfplay command-line tools")
include(CPack)

set_source_files_properties(
  mednafen/src/hw_cpu/m68k/m68k.cpp
  PROPERTIES COMPILE_OPTIONS "$<$<BOOL:${EMSCRIPTEN}>:-O1;-fno-jump-tables>;$<$<NOT:$<BOOL:${EMSCRIPTEN}>>:-O1>"
)
