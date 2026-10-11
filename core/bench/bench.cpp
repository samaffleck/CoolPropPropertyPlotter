// Rough timing of the operations the UI performs, to catch performance regressions.
#include <chrono>
#include <cstdio>

#include "thermo/curves.hpp"
#include "thermo/cycles.hpp"

using namespace thermo;

template <class F>
double ms(F&& f) {
    const auto t0 = std::chrono::steady_clock::now();
    f();
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
}

int main() {
    double tList = ms([] { listFluids(); });
    std::printf("listFluids (all, cold):      %8.1f ms\n", tList);
    for (const char* name : {"Nitrogen", "R134a", "Water", "CO2", "Helium"}) {
        auto& f = getFluid(name);
        const auto& I = f.info();
        std::size_t pts = 0;
        const double tDome = ms([&] { pts = saturationCurves(f).dome.size(); });
        Viewport vp;
        vp.x = Prop::S, vp.y = Prop::T;
        vp.yMin = I.Ttriple, vp.yMax = std::min(I.Tmax, I.Tcrit * 1.8);
        vp.xMin = f.pointAt(Prop::T, I.Ttriple, Prop::Q, 0).s - 200;
        vp.xMax = f.pointAt(Prop::T, I.Ttriple, Prop::Q, 1).s + 1000;
        std::size_t n = 0;
        const Domain d = viewportDomain(f, vp);
        const double tIso = ms([&] {
            for (int i = 0; i < 10; ++i) {
                n += isoline(f, Prop::P, I.ptriple * std::pow(I.pmax / I.ptriple, (i + 0.5) / 10), vp, d).size();
                n += isoline(f, Prop::D, I.rhocrit * std::pow(10.0, i / 3.0 - 2), vp, d).size();
                n += isoline(f, Prop::H, I.hcrit + (i - 5) * 50e3, vp, d).size();
            }
            for (int i = 1; i < 10; ++i) n += isoline(f, Prop::Q, i / 10.0, vp, d).size();
        });
        std::printf("%-9s dome %4zu pts %7.1f ms | 39 isolines (T-s) %6zu pts %7.1f ms\n", name, pts, tDome, n, tIso);
    }
    const double tCycle = ms([] {
        solveCycle("claude", getFluid("Nitrogen"), {{"p_high", 4e6}, {"T_exp_in", 200}, {"exp_fraction", 0.6}});
    });
    std::printf("Claude cycle:                %8.1f ms\n", tCycle);
}
