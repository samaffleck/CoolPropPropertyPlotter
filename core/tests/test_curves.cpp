#include <doctest/doctest.h>

#include <cmath>

#include "thermo/curves.hpp"

using namespace thermo;
using doctest::Approx;

namespace {
Viewport tsViewport(Fluid& f) {
    Viewport vp;
    vp.x = Prop::S, vp.y = Prop::T;
    const auto& I = f.info();
    vp.yMin = I.Ttriple, vp.yMax = I.Tcrit * 1.6;
    vp.xMin = f.pointAt(Prop::T, I.Ttriple, Prop::Q, 0).s - 500;
    vp.xMax = f.pointAt(Prop::T, I.Ttriple, Prop::Q, 1).s + 500;
    return vp;
}
}  // namespace

TEST_CASE("saturation dome is a closed polyline through the critical point") {
    auto& f = getFluid("Nitrogen");
    const auto sat = saturationCurves(f, 100);
    REQUIRE(sat.dome.size() == 201);
    const Point c = sat.dome.at(sat.criticalIndex);
    CHECK(c.T == Approx(f.info().Tcrit));
    CHECK(sat.dome.at(0).Q == 0);
    CHECK(sat.dome.at(sat.dome.size() - 1).Q == 1);
    for (std::size_t i = 1; i <= sat.criticalIndex; ++i) CHECK(sat.dome.at(i).T > sat.dome.at(i - 1).T);
    CHECK(sat.melting.size() > 10);
}

TEST_CASE("subcritical isobar crosses the dome at saturation") {
    auto& f = getFluid("Water");
    const Viewport vp = tsViewport(f);
    const Curve c = isoline(f, Prop::P, 101325, vp);
    REQUIRE(c.size() > 30);
    int twoPhase = 0;
    for (std::size_t i = 0; i < c.size(); ++i) {
        const Point p = c.at(i);
        CHECK(p.p == Approx(101325).epsilon(1e-6));
        if (p.Q == p.Q) {
            ++twoPhase;
            CHECK(p.T == Approx(373.124).epsilon(1e-5));
        }
        if (i > 0) CHECK(p.s >= c.at(i - 1).s - 1e-6);  // entropy increases along an isobar with T
    }
    CHECK(twoPhase >= 2);
}

TEST_CASE("isolines of every kind produce data on a P-h chart") {
    auto& f = getFluid("R134a");
    Viewport vp;
    vp.x = Prop::H, vp.y = Prop::P, vp.yLog = true;
    vp.xMin = 100e3, vp.xMax = 500e3, vp.yMin = 5e4, vp.yMax = 6e6;
    CHECK(isoline(f, Prop::T, 300, vp).size() > 20);
    CHECK(isoline(f, Prop::S, 1750, vp).size() > 10);
    CHECK(isoline(f, Prop::D, 20, vp).size() > 10);
    CHECK(isoline(f, Prop::Q, 0.5, vp).size() > 10);
    CHECK(isoline(f, Prop::P, 1e6, vp).size() > 5);
    CHECK(isoline(f, Prop::H, 300e3, vp).size() > 5);
}

TEST_CASE("supercritical isobar and isotherm") {
    auto& f = getFluid("CO2");
    const Viewport vp = tsViewport(f);
    const Curve ib = isoline(f, Prop::P, 10e6, vp);
    CHECK(ib.size() > 30);
    const Curve it = isoline(f, Prop::T, 310, vp);
    CHECK(it.size() > 20);
}

TEST_CASE("adaptive sampler refines curvature and respects breaks") {
    Viewport vp;
    vp.x = Prop::T, vp.y = Prop::P, vp.xMin = 0, vp.xMax = 1, vp.yMin = 0, vp.yMax = 1;
    // Straight line needs no refinement beyond the minimum resolution.
    const Curve line = sampleAdaptive([](double t) { return Point{t, t, 1, 1, 1, NaN}; }, 0, 1, vp, 4);
    const Curve bend = sampleAdaptive([](double t) { return Point{t, std::abs(t - 0.5137), 1, 1, 1, NaN}; }, 0, 1, vp, 4);
    CHECK(bend.size() > line.size());
    // Undefined middle region produces a break row.
    const Curve gap = sampleAdaptive(
        [](double t) -> std::optional<Point> {
            if (t > 0.4 && t < 0.6) return std::nullopt;
            return Point{t, t, 1, 1, 1, NaN};
        },
        0, 1, vp, 10);
    bool hasBreak = false;
    for (std::size_t i = 0; i < gap.size(); ++i) hasBreak |= std::isnan(gap.at(i).T);
    CHECK(hasBreak);
}
