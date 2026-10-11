#include <doctest/doctest.h>

#include "thermo/fluid.hpp"

using namespace thermo;
using doctest::Approx;

TEST_CASE("fluid constants") {
    auto& w = getFluid("Water");
    CHECK(w.info().Tcrit == Approx(647.096).epsilon(1e-6));
    CHECK(w.info().pcrit == Approx(22.064e6).epsilon(1e-6));
    CHECK(w.info().ptriple == Approx(611.655).epsilon(1e-3));
    CHECK(w.info().hasMeltingLine);
    auto& n2 = getFluid("Nitrogen");
    CHECK(n2.info().molarMass == Approx(0.0280134).epsilon(1e-5));
    CHECK(&getFluid("Nitrogen") == &n2);
}

TEST_CASE("saturation reference points") {
    auto& n2 = getFluid("Nitrogen");
    CHECK(n2.pointAt(Prop::P, 101325, Prop::Q, 0).T == Approx(77.355).epsilon(1e-4));
    auto& w = getFluid("Water");
    CHECK(w.pointAt(Prop::P, 101325, Prop::Q, 1).T == Approx(373.124).epsilon(1e-5));
    auto& r = getFluid("R134a");
    CHECK(r.pointAt(Prop::P, 101325, Prop::Q, 0).T == Approx(247.08).epsilon(1e-3));
}

TEST_CASE("flash round trips across input pairs") {
    auto& f = getFluid("CO2");
    const State a = f.stateAt(Prop::P, 5e6, Prop::T, 320);
    REQUIRE(a.valid);
    CHECK(a.phase == Phase::SupercriticalGas);  // T > Tc = 304 K
    CHECK(f.pointAt(Prop::P, a.p, Prop::H, a.h).T == Approx(320).epsilon(1e-8));
    CHECK(f.pointAt(Prop::P, a.p, Prop::S, a.s).T == Approx(320).epsilon(1e-8));
    CHECK(f.pointAt(Prop::D, a.rho, Prop::T, 320).p == Approx(5e6).epsilon(1e-8));
    CHECK(f.pointAt(Prop::V, 1 / a.rho, Prop::T, 320).p == Approx(5e6).epsilon(1e-8));
    CHECK(f.pointAt(Prop::H, a.h, Prop::S, a.s).T == Approx(320).epsilon(1e-6));
    CHECK(f.pointAt(Prop::T, 320, Prop::S, a.s).p == Approx(5e6).epsilon(1e-6));
}

TEST_CASE("full state has transport and derived properties") {
    auto& f = getFluid("Nitrogen");
    const State s = f.stateAt(Prop::P, 1e5, Prop::T, 300);
    CHECK(s.cp == Approx(1041).epsilon(2e-3));
    CHECK(s.mu == Approx(17.9e-6).epsilon(1e-2));
    CHECK(s.k == Approx(0.0259).epsilon(2e-2));
    CHECK(s.muJT > 0);  // nitrogen cools on throttling at ambient
    CHECK(getFluid("Hydrogen").stateAt(Prop::P, 1e5, Prop::T, 300).muJT < 0);
    const State two = f.stateAt(Prop::P, 1e5, Prop::Q, 0.3);
    CHECK(two.phase == Phase::TwoPhase);
    CHECK(two.Q == Approx(0.3));
    CHECK(two.sigma > 0);
}

TEST_CASE("invalid input fails without throwing") {
    auto& f = getFluid("Water");
    CHECK_FALSE(f.update(Prop::T, 300, Prop::T, 310));
    CHECK_FALSE(f.update(Prop::P, -5, Prop::T, 310));
    CHECK_FALSE(f.update(Prop::P, 1e5, Prop::T, NaN));
    CHECK_FALSE(f.stateAt(Prop::T, 700, Prop::Q, 0.5).valid);
}

TEST_CASE("fluid list") {
    const auto all = listFluids();
    CHECK(all.size() > 100);
}
