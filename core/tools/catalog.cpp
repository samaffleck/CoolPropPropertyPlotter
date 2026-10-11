// Writes the fluid catalog (name, aliases, critical/triple points, safety class...) as JSON.
// Run at build time so the web app can list fluids instantly without instantiating every EOS.
#include <cmath>
#include <cstdio>
#include <string>

#include "thermo/fluid.hpp"

namespace {
std::string str(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') out += '\\';
        out += c;
    }
    return out + "\"";
}
std::string num(double v) {
    if (!std::isfinite(v)) return "null";
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.8g", v);
    return buf;
}
}  // namespace

int main() {
    const auto fluids = thermo::listFluids();
    std::printf("[\n");
    for (std::size_t i = 0; i < fluids.size(); ++i) {
        const auto& f = fluids[i];
        std::printf(
            "  {\"name\":%s,\"aliases\":%s,\"cas\":%s,\"ashrae34\":%s,\"formula\":%s,\"molarMass\":%s,"
            "\"Tcrit\":%s,\"pcrit\":%s,\"Ttriple\":%s,\"ptriple\":%s,\"Tmax\":%s,\"pmax\":%s,\"gwp100\":%s,\"odp\":%s}%s\n",
            str(f.name).c_str(), str(f.aliases).c_str(), str(f.cas).c_str(), str(f.ashrae34).c_str(),
            str(f.formula).c_str(), num(f.molarMass).c_str(), num(f.Tcrit).c_str(), num(f.pcrit).c_str(),
            num(f.Ttriple).c_str(), num(f.ptriple).c_str(), num(f.Tmax).c_str(), num(f.pmax).c_str(),
            num(f.gwp100).c_str(), num(f.odp).c_str(), i + 1 < fluids.size() ? "," : "");
    }
    std::printf("]\n");
}
