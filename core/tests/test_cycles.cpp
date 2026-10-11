#include <doctest/doctest.h>

#include "helpers.hpp"
#include "thermo/cycles.hpp"

using namespace thermo;
using doctest::Approx;

TEST_CASE("vapour compression: R134a -10/+40") {
    auto& f = getFluid("R134a");
    const auto ideal = solveCycle("vapor_compression", f,
                                  {{"T_evap", 263.15}, {"T_cond", 313.15}, {"superheat", 0}, {"subcool", 0}, {"eta_comp", 1}});
    REQUIRE_MESSAGE(ideal.ok, ideal.error);
    // Hand calc: h1 = 392.7, h2s = 426, h3 = 256.4 kJ/kg -> COP = 136.3 / 33.5 = 4.07
    CHECK(metric(ideal, "cop_cooling") == Approx(4.05).epsilon(0.02));

    const auto r = solveCycle("vapor_compression", f, {{"T_evap", 263.15}, {"T_cond", 313.15}, {"eta_comp", 0.75},
                                                        {"T_ambient", 303.15}, {"T_cold_space", 271.15}});
    REQUIRE(r.ok);
    CHECK(metric(r, "q_evap") + metric(r, "w_comp") == Approx(metric(r, "q_cond")));
    CHECK(metric(r, "cop_cooling") < metric(ideal, "cop_cooling"));
    const double T0 = 303.15, Tc = 271.15;
    CHECK(exergySum(r) == Approx(metric(r, "w_comp") - metric(r, "q_evap") * (T0 / Tc - 1)).epsilon(1e-9));
    CHECK(r.segments.size() == 4);
}

TEST_CASE("transcritical CO2") {
    auto& f = getFluid("CO2");
    const auto r = solveCycle("transcritical", f, {{"T_evap", 268.15}, {"p_high", 10e6}, {"T_gc_out", 308.15}});
    REQUIRE_MESSAGE(r.ok, r.error);
    CHECK(metric(r, "cop_cooling") > 1.5);
    CHECK(metric(r, "cop_cooling") < 4);
}

TEST_CASE("subcritical cycle rejects supercritical condensing") {
    const auto r = solveCycle("vapor_compression", getFluid("CO2"), {{"T_evap", 268.15}, {"T_cond", 320}});
    CHECK_FALSE(r.ok);
    CHECK(r.error.find("transcritical") != std::string::npos);
}

TEST_CASE("reverse Brayton helium cryocooler") {
    auto& f = getFluid("Helium");
    const auto r = solveCycle("reverse_brayton", f, {{"p_low", 1e6}, {"pressure_ratio", 2}, {"T_ambient", 300},
                                                      {"T_load", 77}, {"effectiveness", 0.98}});
    REQUIRE_MESSAGE(r.ok, r.error);
    CHECK(metric(r, "fom") > 0);
    CHECK(metric(r, "fom") < 1);
    const double qload = metric(r, "q_load");
    CHECK(exergySum(r) == Approx(metric(r, "w_net") - qload * (300.0 / 77 - 1)).epsilon(1e-8));
    REQUIRE(r.exchangers.size() == 1);
    CHECK(r.exchangers[0].minApproach > 0);
}

TEST_CASE("Brayton power cycle, with and without recuperator") {
    auto& f = getFluid("Air");
    const auto simple = solveCycle("brayton", f, {{"pressure_ratio", 10}, {"T_turbine_in", 1200}});
    REQUIRE_MESSAGE(simple.ok, simple.error);
    CHECK(simple.states.size() == 4);
    const auto recup = solveCycle("brayton", f, {{"pressure_ratio", 4}, {"T_turbine_in", 1200}, {"effectiveness", 0.85}});
    REQUIRE(recup.ok);
    CHECK(recup.states.size() == 6);
    const auto norecup = solveCycle("brayton", f, {{"pressure_ratio", 4}, {"T_turbine_in", 1200}});
    CHECK(metric(recup, "eta_th") > metric(norecup, "eta_th"));
}

TEST_CASE("Rankine steam cycle") {
    const auto r = solveCycle("rankine", getFluid("Water"),
                              {{"T_cond", 313.15}, {"p_boiler", 10e6}, {"T_turbine_in", 773.15}, {"eta_pump", 1}, {"eta_turb", 1}});
    REQUIRE_MESSAGE(r.ok, r.error);
    CHECK(metric(r, "eta_th") == Approx(0.40).epsilon(0.03));
}

TEST_CASE("Linde-Hampson nitrogen liquefier") {
    auto& f = getFluid("Nitrogen");
    const auto r = solveCycle("linde_hampson", f, {{"p_high", 20.2e6}, {"p_low", 101325}, {"T_ambient", 300}, {"eta_iso", 1}});
    REQUIRE_MESSAGE(r.ok, r.error);
    const double y = metric(r, "yield");
    CHECK(y == Approx(0.0708).epsilon(0.08));  // Barron, Cryogenic Systems: y = 0.0708
    CHECK(1 - stateOf(r, "4").Q == Approx(y).epsilon(1e-6));
    CHECK(exergySum(r) == Approx(metric(r, "w_comp") - y * metric(r, "w_ideal")).epsilon(1e-6));
}

TEST_CASE("Linde-Hampson refuses hydrogen at ambient temperature") {
    const auto r = solveCycle("linde_hampson", getFluid("Hydrogen"), {{"p_high", 10e6}, {"T_ambient", 300}});
    CHECK_FALSE(r.ok);
    CHECK(r.error.find("Joule-Thomson") != std::string::npos);
}

TEST_CASE("Claude nitrogen liquefier balances") {
    auto& f = getFluid("Nitrogen");
    const CycleParams p = {{"p_high", 4e6}, {"p_low", 101325}, {"T_ambient", 300}, {"T_exp_in", 200},
                           {"exp_fraction", 0.6}, {"eta_exp", 0.8}, {"eta_iso", 0.6}};
    const auto r = solveCycle("claude", f, p);
    REQUIRE_MESSAGE(r.ok, r.error);
    const double y = metric(r, "yield");
    CHECK(y > 0.05);
    CHECK((1 - 0.6) * (1 - stateOf(r, "6").Q) == Approx(y).epsilon(1e-6));
    const double wnet = metric(r, "w_comp") - metric(r, "w_exp");
    CHECK(exergySum(r) == Approx(wnet - y * metric(r, "w_ideal")).epsilon(1e-6));
    CHECK(r.exchangers.size() == 3);
    const auto lh = solveCycle("linde_hampson", f, p);
    REQUIRE(lh.ok);
    CHECK(y > metric(lh, "yield"));
}

TEST_CASE("unknown cycle") { CHECK_FALSE(solveCycle("nope", getFluid("Water"), {}).ok); }
