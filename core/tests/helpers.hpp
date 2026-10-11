#pragma once
#include <doctest/doctest.h>

#include <string>

#include "thermo/cycles.hpp"

inline double metric(const thermo::CycleResult& r, const std::string& key) {
    for (const auto& m : r.metrics)
        if (m.key == key) return m.value;
    FAIL("missing metric " << key);
    return 0;
}

inline double exergySum(const thermo::CycleResult& r) {
    double sum = 0;
    for (const auto& m : r.metrics)
        if (m.group == "exergy") sum += m.value;
    return sum;
}

inline const thermo::State& stateOf(const thermo::CycleResult& r, const std::string& id) {
    for (const auto& s : r.states)
        if (s.id == id) return s.state;
    FAIL("missing state " << id);
    return r.states.front().state;
}
