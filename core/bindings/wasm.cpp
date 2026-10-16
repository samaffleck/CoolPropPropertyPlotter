// Embind interface consumed by the web worker (web/src/engine). Everything crosses the boundary
// as plain JS objects; curves are copied out as Float64Array so they can be transferred.
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cmath>
#include <string>

#include "CoolProp/CoolProp.h"
#include "CoolProp/AbstractState.h"
#include "thermo/curves.hpp"
#include "thermo/cycles.hpp"
#include "thermo/fluid.hpp"
#include "thermo/process.hpp"

using emscripten::val;
using namespace thermo;

namespace {

val toArray(const std::vector<double>& v) {
    return val(emscripten::typed_memory_view(v.size(), v.data())).call<val>("slice");
}

val toJs(const Curve& c) { return toArray(c.data); }

val toJs(const Point& s) {
    val o = val::object();
    o.set("T", s.T);
    o.set("p", s.p);
    o.set("rho", s.rho);
    o.set("v", 1.0 / s.rho);
    o.set("h", s.h);
    o.set("s", s.s);
    o.set("Q", s.Q);
    return o;
}

val toJs(const State& s) {
    if (!s.valid) return val::null();
    val o = toJs(s.point());
    o.set("phase", std::string(phaseName(s.phase)));
    o.set("u", s.u);
    o.set("cp", s.cp);
    o.set("cv", s.cv);
    o.set("gamma", s.cp / s.cv);
    o.set("w", s.w);
    o.set("mu", s.mu);
    o.set("k", s.k);
    o.set("Pr", s.Pr);
    o.set("Z", s.Z);
    o.set("beta", s.beta);
    o.set("kappaT", s.kappaT);
    o.set("muJT", s.muJT);
    o.set("sigma", s.sigma);
    return o;
}

val toJs(const FluidInfo& i) {
    val o = val::object();
    o.set("name", i.name);
    o.set("aliases", i.aliases);
    o.set("cas", i.cas);
    o.set("ashrae34", i.ashrae34);
    o.set("formula", i.formula);
    o.set("molarMass", i.molarMass);
    o.set("Tcrit", i.Tcrit);
    o.set("pcrit", i.pcrit);
    o.set("rhocrit", i.rhocrit);
    o.set("hcrit", i.hcrit);
    o.set("scrit", i.scrit);
    o.set("Ttriple", i.Ttriple);
    o.set("ptriple", i.ptriple);
    o.set("Tmin", i.Tmin);
    o.set("Tmax", i.Tmax);
    o.set("pmax", i.pmax);
    o.set("acentric", i.acentric);
    o.set("gwp100", i.gwp100);
    o.set("odp", i.odp);
    o.set("hasMeltingLine", i.hasMeltingLine);
    return o;
}

Prop prop(int p) { return static_cast<Prop>(p); }

Viewport viewport(const val& v) {
    Viewport vp;
    vp.x = prop(v["x"].as<int>());
    vp.y = prop(v["y"].as<int>());
    vp.xLog = v["xLog"].as<bool>();
    vp.yLog = v["yLog"].as<bool>();
    vp.xMin = v["xMin"].as<double>();
    vp.xMax = v["xMax"].as<double>();
    vp.yMin = v["yMin"].as<double>();
    vp.yMax = v["yMax"].as<double>();
    if (v.hasOwnProperty("tolerance")) vp.tolerance = v["tolerance"].as<double>();
    return vp;
}

val error(const std::string& msg) {
    val o = val::object();
    o.set("ok", false);
    o.set("error", msg);
    return o;
}

// ---- exported functions ----

// Register a fluid from its JSON definition (web/public/fluids/<name>.json).
val loadFluid(const std::string& json) {
    try {
        CoolProp::add_fluids_as_JSON("HEOS", json);
        val o = val::object();
        o.set("ok", true);
        return o;
    } catch (const std::exception& e) {
        return error(e.what());
    }
}

val fluidInfo(const std::string& name) {
    try {
        return toJs(getFluid(name).info());
    } catch (const std::exception& e) {
        return val::null();
    }
}

val state(const std::string& fluid, int a, double va, int b, double vb) {
    try {
        auto& f = getFluid(fluid);
        const State s = f.stateAt(prop(a), va, prop(b), vb);
        if (!s.valid) return error(f.lastError());
        val o = val::object();
        o.set("ok", true);
        o.set("state", toJs(s));
        return o;
    } catch (const std::exception& e) {
        return error(e.what());
    }
}

// Coordinates for viewport probes, without transport properties or derivatives.
val point(const std::string& fluid, int a, double va, int b, double vb) {
    try {
        auto& f = getFluid(fluid);
        if (!f.update(prop(a), va, prop(b), vb)) return error(f.lastError());
        val coordinates = toJs(f.point());
        double u = NaN;
        try {
            const double value = f.backend().umass();
            if (std::isfinite(value)) u = value;
        } catch (...) {
            // Internal energy can be unavailable even when the flash succeeds.
        }
        coordinates.set("u", u);
        val o = val::object();
        o.set("ok", true);
        o.set("point", coordinates);
        return o;
    } catch (const std::exception& e) {
        return error(e.what());
    }
}

val saturation(const std::string& fluid) {
    try {
        const auto sat = saturationCurves(getFluid(fluid));
        val o = val::object();
        o.set("dome", toJs(sat.dome));
        o.set("criticalIndex", static_cast<int>(sat.criticalIndex));
        o.set("melting", toJs(sat.melting));
        return o;
    } catch (const std::exception& e) {
        return error(e.what());
    }
}

// isolines: [{ prop: number, values: number[] }]
val chart(const std::string& fluid, const val& vpJs, const val& isolines) {
    try {
        auto& f = getFluid(fluid);
        const Viewport vp = viewport(vpJs);
        const Domain d = viewportDomain(f, vp);
        val out = val::array();
        const int nGroups = isolines["length"].as<int>();
        for (int g = 0; g < nGroups; ++g) {
            const val group = isolines[g];
            const int p = group["prop"].as<int>();
            const val values = group["values"];
            const int n = values["length"].as<int>();
            for (int i = 0; i < n; ++i) {
                const double v = values[i].as<double>();
                val line = val::object();
                line.set("prop", p);
                line.set("value", v);
                line.set("data", toJs(isoline(f, prop(p), v, vp, d)));
                out.call<void>("push", line);
            }
        }
        val o = val::object();
        o.set("ok", true);
        o.set("isolines", out);
        val dom = val::object();
        dom.set("Tmin", d.Tmin);
        dom.set("Tmax", d.Tmax);
        dom.set("pmin", d.pmin);
        dom.set("pmax", d.pmax);
        o.set("domain", dom);
        return o;
    } catch (const std::exception& e) {
        return error(e.what());
    }
}

// start: { a, va, b, vb }   spec: { kind, target, value, efficiency }
val process(const std::string& fluid, const val& start, const val& spec) {
    try {
        auto& f = getFluid(fluid);
        const State s0 = f.stateAt(prop(start["a"].as<int>()), start["va"].as<double>(), prop(start["b"].as<int>()),
                                   start["vb"].as<double>());
        if (!s0.valid) return error("Start state: " + f.lastError());
        ProcessSpec ps;
        ps.kind = static_cast<ProcessKind>(spec["kind"].as<int>());
        ps.target = prop(spec["target"].as<int>());
        ps.value = spec["value"].as<double>();
        if (spec.hasOwnProperty("efficiency")) ps.efficiency = spec["efficiency"].as<double>();
        const auto r = runProcess(f, s0, ps);
        if (!r.ok) return error(r.error);
        val o = val::object();
        o.set("ok", true);
        o.set("start", toJs(s0));
        o.set("end", toJs(r.end));
        o.set("path", toJs(r.path));
        o.set("q", r.q);
        o.set("w", r.w);
        return o;
    } catch (const std::exception& e) {
        return error(e.what());
    }
}

val cycle(const std::string& id, const std::string& fluid, const val& params) {
    try {
        CycleParams p;
        const val keys = val::global("Object").call<val>("keys", params);
        const int n = keys["length"].as<int>();
        for (int i = 0; i < n; ++i) {
            const auto k = keys[i].as<std::string>();
            p[k] = params[k].as<double>();
        }
        const auto r = solveCycle(id, getFluid(fluid), p);
        if (!r.ok) return error(r.error);

        val o = val::object();
        o.set("ok", true);
        val states = val::array();
        for (const auto& s : r.states) {
            val js = val::object();
            js.set("id", s.id);
            js.set("label", s.label);
            js.set("flow", s.flow);
            js.set("state", toJs(s.state));
            states.call<void>("push", js);
        }
        o.set("states", states);
        val segs = val::array();
        for (const auto& s : r.segments) {
            val js = val::object();
            js.set("from", s.from);
            js.set("to", s.to);
            js.set("component", s.component);
            js.set("kind", s.kind);
            js.set("path", toJs(s.path));
            segs.call<void>("push", js);
        }
        o.set("segments", segs);
        val metrics = val::array();
        for (const auto& m : r.metrics) {
            val js = val::object();
            js.set("key", m.key);
            js.set("label", m.label);
            js.set("quantity", m.quantity);
            js.set("group", m.group);
            js.set("value", m.value);
            metrics.call<void>("push", js);
        }
        o.set("metrics", metrics);
        val hx = val::array();
        for (const auto& x : r.exchangers) {
            val js = val::object();
            js.set("name", x.name);
            js.set("q", toArray(x.q));
            js.set("Thot", toArray(x.Thot));
            js.set("Tcold", toArray(x.Tcold));
            js.set("minApproach", x.minApproach);
            hx.call<void>("push", js);
        }
        o.set("exchangers", hx);
        val warnings = val::array();
        for (const auto& w : r.warnings) warnings.call<void>("push", w);
        o.set("warnings", warnings);
        return o;
    } catch (const std::exception& e) {
        return error(e.what());
    }
}

}  // namespace

EMSCRIPTEN_BINDINGS(thermo) {
    emscripten::function("loadFluid", &loadFluid);
    emscripten::function("fluidInfo", &fluidInfo);
    emscripten::function("state", &state);
    emscripten::function("point", &point);
    emscripten::function("saturation", &saturation);
    emscripten::function("chart", &chart);
    emscripten::function("process", &process);
    emscripten::function("cycle", &cycle);
}
