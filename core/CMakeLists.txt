cmake_minimum_required(VERSION 3.20)
project(thermo_core LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

option(THERMO_BUILD_TESTS "Build native unit tests and benchmarks" ON)

if(EMSCRIPTEN)
  # Native WebAssembly exceptions: CoolProp reports solver failures by throwing.
  add_compile_options(-fwasm-exceptions)
  add_link_options(-fwasm-exceptions)
  # incbin relies on assembler directives that wasm does not support.
  add_compile_definitions(COOLPROP_NO_INCBIN)
  set(THERMO_BUILD_TESTS OFF)
endif()

# ---- CoolProp ----
set(COOLPROP_STATIC_LIBRARY ON CACHE BOOL "" FORCE)
set(COOLPROP_NO_EXAMPLES ON CACHE BOOL "" FORCE)
add_subdirectory(external/CoolProp EXCLUDE_FROM_ALL)
if(EMSCRIPTEN)
  # Shadow the embedded fluid library with an empty one; fluids are loaded on demand (see wasm/).
  target_include_directories(CoolProp BEFORE PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/wasm)
endif()

# ---- thermo core ----
add_library(thermo STATIC
  src/fluid.cpp
  src/curves.cpp
  src/process.cpp
  src/cycles.cpp)
target_include_directories(thermo PUBLIC include)
target_link_libraries(thermo PUBLIC CoolProp)
if(NOT MSVC)
  target_compile_options(thermo PRIVATE -Wall -Wextra)
endif()

if(EMSCRIPTEN)
  add_executable(thermo_wasm bindings/wasm.cpp)
  target_link_libraries(thermo_wasm PRIVATE thermo)
  set_target_properties(thermo_wasm PROPERTIES OUTPUT_NAME "thermo" SUFFIX ".mjs")
  target_link_options(thermo_wasm PRIVATE
    -lembind
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createThermo
    -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=33554432
    -sFILESYSTEM=0
    $<$<CONFIG:Release>:-O3 -flto>)
  target_compile_options(thermo_wasm PRIVATE $<$<CONFIG:Release>:-O3 -flto>)
endif()

if(THERMO_BUILD_TESTS)
  include(FetchContent)
  FetchContent_Declare(doctest
    URL https://github.com/doctest/doctest/archive/refs/tags/v2.4.11.tar.gz)
  set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
  FetchContent_MakeAvailable(doctest)
  add_executable(thermo_tests tests/test_main.cpp tests/test_fluid.cpp tests/test_curves.cpp
                              tests/test_process.cpp tests/test_cycles.cpp)
  target_link_libraries(thermo_tests PRIVATE thermo doctest::doctest)
  add_executable(thermo_bench bench/bench.cpp)
  target_link_libraries(thermo_bench PRIVATE thermo)
endif()

if(NOT EMSCRIPTEN)
  add_executable(thermo_catalog tools/catalog.cpp)
  target_link_libraries(thermo_catalog PRIVATE thermo)
endif()
