"""Split CoolProp's fluid library into one JSON file per fluid for on-demand loading by the web app.

Only the first (default) equation of state is kept; alternative EOS entries are never used by the
HEOS backend unless explicitly requested.

usage: python3 tools/split_fluids.py <CoolProp/dev/all_fluids.json> <out_dir>
"""
import json
import os
import sys


def main(src: str, out_dir: str) -> None:
    fluids = json.load(open(src))
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for fluid in fluids:
        fluid["EOS"] = fluid["EOS"][:1]
        name = fluid["INFO"]["NAME"]
        path = os.path.join(out_dir, f"{name}.json")
        with open(path, "w") as fh:
            json.dump([fluid], fh, separators=(",", ":"))
        total += os.path.getsize(path)
    print(f"wrote {len(fluids)} fluids, {total / 1e6:.1f} MB to {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
