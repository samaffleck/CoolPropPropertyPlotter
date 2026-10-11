#include <doctest/doctest.h>

#include "thermo/process.hpp"

using namespace thermo;
using doctest::Approx;

TEST_CASE("process end states and energy balance") {
    auto& f = getFluid("Nitrogen");
    const State in = f.stateAt(Prop::P, 1e5, Prop::T, 300);

    SUBCASE("isentropic compression") {
        const auto r = runProcess(f, in, {ProcessKind::Isentropic, Prop::P, 5e5});
        REQUIRE(r.ok);
        CHECK(r.end.s == Approx(in.s).epsilon(1e-8));
        CHECK(r.w == Approx(in.h - r.end.h));
        CHECK(r.end.T == Approx(300 * std::pow(5.0, 0.4 / 1.4)).epsilon(5e-3));
    }
    SUBCASE("compressor with efficiency") {
        const auto iso = runProcess(f, in, {ProcessKind::Isentropic, Prop::P, 5e5});
        const auto r = runProcess(f, in, {ProcessKind::Compression, Prop::P, 5e5, 0.8});
        REQUIRE(r.ok);
        CHECK(-r.w == Approx(-iso.w / 0.8).epsilon(1e-8));
        CHECK(r.end.s > in.s);
        CHECK(r.path.size() > 5);
    }
    SUBCASE("throttling conserves enthalpy") {
        const State hp = f.stateAt(Prop::P, 200e5, Prop::T, 150);
        const auto r = runProcess(f, hp, {ProcessKind::Isenthalpic, Prop::P, 1e5});
        REQUIRE(r.ok);
        CHECK(r.end.h == Approx(hp.h).epsilon(1e-9));
        CHECK(r.end.phase == Phase::TwoPhase);
    }
    SUBCASE("isobaric cooling into the dome") {
        const auto r = runProcess(f, in, {ProcessKind::Isobaric, Prop::Q, 0.5});
        REQUIRE(r.ok);
        CHECK(r.q == Approx(r.end.h - in.h));
        CHECK(r.end.T == Approx(77.24).epsilon(1e-3));
    }
    SUBCASE("isothermal compression") {
        const auto r = runProcess(f, in, {ProcessKind::Isothermal, Prop::P, 1e6});
        REQUIRE(r.ok);
        CHECK(r.end.T == Approx(300));
        CHECK(r.w < 0);
        CHECK(r.q - r.w == Approx(r.end.h - in.h));
    }
    SUBCASE("isochoric heating") {
        const auto r = runProcess(f, in, {ProcessKind::Isochoric, Prop::T, 400});
        REQUIRE(r.ok);
        CHECK(r.end.rho == Approx(in.rho));
        CHECK(r.q - r.w == Approx(r.end.h - in.h));
    }
    SUBCASE("invalid specs are reported") {
        CHECK_FALSE(runProcess(f, in, {ProcessKind::Isobaric, Prop::P, 2e5}).ok);
        CHECK_FALSE(runProcess(f, in, {ProcessKind::Compression, Prop::P, 0.5e5, 0.8}).ok);
        CHECK_FALSE(runProcess(f, in, {ProcessKind::Expansion, Prop::T, 200, 0.8}).ok);
    }
}
