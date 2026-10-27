"""Build public/how-data.json: the small street map in the /how page's example form.

Projects NYC CSCL street centerlines (worker/cscl.json) around Hudson St and Christopher St into SVG coordinates,
with street labels and the corners a resident can pick, so the page can show the same
"drag the dot or pick the corner" control as the real form without a map service.

    python3 scripts/build_how_data.py
"""

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSCL = json.loads((ROOT / "worker/cscl.json").read_text())

W, H = 400, 230
KX = math.cos(math.radians(40.729))  # a degree of longitude is this much shorter than one of latitude
EPS = 0.00015
MAJOR = {"W HOUSTON ST", "LA GUARDIA PL", "BLEECKER ST", "W 3 ST", "W 4 ST", "AVE OF THE AMERICAS"}
PRETTY = {"W 3 ST": "W 3rd St", "W 4 ST": "W 4th St", "LA GUARDIA PL": "LaGuardia Pl", "W HOUSTON ST": "W Houston St",
          "AVE OF THE AMERICAS": "Sixth Ave", "WASHINGTON SQ S": "Washington Sq S"}


def pretty(name):
    return PRETTY.get(name) or " ".join(w if w in ("E", "W") else w.title() for w in name.split())


def segments(name):
    pts = CSCL[name]
    return [(pts[i], pts[i + 1]) for i in range(0, len(pts) - 1, 2)]


def corner(a, b):
    """A node two streets share is where they meet."""
    na = [p for s in segments(a) for p in s]
    for s in segments(b):
        for p in s:
            for q in na:
                if abs(p[0] - q[0]) < EPS and abs(p[1] - q[1]) < EPS:
                    return q
    raise SystemExit(f"no corner {a} / {b}")


class View:
    def __init__(self, center, lat_span):
        self.lat_span = lat_span
        self.lon_span = lat_span * W / H / KX
        self.x0 = center[0] - self.lon_span / 2
        self.y1 = center[1] + lat_span / 2

    def xy(self, p):
        return [round((p[0] - self.x0) / self.lon_span * W, 1), round((self.y1 - p[1]) / self.lat_span * H, 1)]

    def inside(self, p, pad=0.15):
        x, y = self.xy(p)
        return -W * pad <= x <= W * (1 + pad) and -H * pad <= y <= H * (1 + pad)


def label(view, name, at, off=0):
    """A street label on the segment nearest `at`, rotated to follow it."""
    best = None
    for s in segments(name):
        (x1, y1), (x2, y2) = view.xy(s[0]), view.xy(s[1])
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        if not (44 < mx < W - 44 and 14 < my < H - 14):
            continue
        ax, ay = view.xy(at)
        d = math.hypot(mx - ax, my - ay)
        if best is None or d < best[0]:
            ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
            ang = ang - 180 if ang > 90 else ang + 180 if ang < -90 else ang
            # `off` nudges the label to the side of the street, clear of the dot on it.
            r = math.radians(ang + 90)
            best = (d, {"t": pretty(name), "x": round(mx + off * math.cos(r), 1), "y": round(my + off * math.sin(r), 1), "a": round(ang, 1)})
    return best and best[1]


def main():
    main_st, main_label = "HUDSON ST", "Hudson St"
    c0 = corner(main_st, "CHRISTOPHER ST")
    view = View((c0[0] - 0.0004, c0[1] - 0.0007), 0.0060)
    streets = []
    for name in CSCL:
        ds = [view.xy(a) + view.xy(b) for a, b in segments(name) if view.inside(a) or view.inside(b)]
        if ds:
            streets.append({"m": int(name in MAJOR), "d": ds})
    cross = ["CHRISTOPHER ST", "BARROW ST", "MORTON ST"]
    corners = []
    for c in cross:
        try:
            p = corner(main_st, c)
        except SystemExit:
            continue
        if view.inside(p, -0.05):
            corners.append({"label": f"{main_label} & {pretty(c)}", **dict(zip("xy", view.xy(p))),
                            "street": [view.xy(a) + view.xy(b) for a, b in segments(c) if view.inside(a) or view.inside(b)]})
    # One label per street, spread out so they don't pile up around the corners.
    labels = [label(view, n, at, *o) for n, at, *o in [
        (main_st, corner(main_st, "W 10 ST"), -14), ("CHRISTOPHER ST", corner("CHRISTOPHER ST", "WASHINGTON ST")),
        ("BARROW ST", corner("BARROW ST", "GREENWICH ST")), ("MORTON ST", corner("MORTON ST", "GREENWICH ST")),
        ("BLEECKER ST", corner("BLEECKER ST", "GROVE ST")),
    ]]
    main = [view.xy(a) + view.xy(b) for a, b in segments(main_st) if view.inside(a) or view.inside(b)]
    data = {"w": W, "h": H, "streets": streets, "main": main, "labels": [l for l in labels if l], "corners": corners}
    out = ROOT / "public/how-data.json"
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size // 1024} KB): {[c['label'] for c in corners]}")


if __name__ == "__main__":
    main()
