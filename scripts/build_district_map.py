# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely>=2", "truststore"]
# ///
"""Draw the tiny district map in the page header: lower Manhattan's community districts, with
CB2 and CB3 outlined and labeled. Writes an inline <svg> between the district-map markers in
public/index.html; CSS fills the district the page runs as (.cdmap[data-board=cb3] .cd-103).

Usage: uv run scripts/build_district_map.py
"""

import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

import truststore
from shapely.geometry import box, shape

truststore.inject_into_ssl()  # the system trust store, so a proxy or corporate CA works

URL = "https://data.cityofnewyork.us/resource/5crt-au7u.geojson"
BOARDS = {"102": "cb2", "103": "cb3"}
# Chambers St to about 23rd St, river to river: enough of the island to see where the two boards sit.
WEST, EAST, SOUTH, NORTH = -74.024, -73.962, 40.700, 40.752
HEIGHT = 100  # viewBox units; the width follows the map's aspect
KX = math.cos(
    math.radians((SOUTH + NORTH) / 2)
)  # metres per degree of longitude shrink with latitude
WIDTH = round((EAST - WEST) * KX / (NORTH - SOUTH) * HEIGHT, 1)


def xy(lng: float, lat: float) -> tuple[float, float]:
    return (
        (lng - WEST) * KX / (NORTH - SOUTH) * HEIGHT,
        (NORTH - lat) / (NORTH - SOUTH) * HEIGHT,
    )


def path(geom) -> str:
    polys = getattr(geom, "geoms", [geom])
    out = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = [xy(x, y) for x, y in ring.coords]
            if len(pts) >= 4:
                out.append(
                    "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts[:-1]) + "Z"
                )
    return "".join(out)


q = urllib.parse.urlencode({"$where": "boro_cd between 101 and 112"})
features = json.load(urllib.request.urlopen(f"{URL}?{q}", timeout=60))["features"]
frame = box(WEST - 0.01, SOUTH - 0.01, EAST + 0.01, NORTH + 0.01)
paths, labels = [], []
for f in sorted(
    features, key=lambda f: f["properties"]["boro_cd"] in BOARDS
):  # the boards draw on top
    cd = f["properties"]["boro_cd"]
    g = (
        shape(f["geometry"])
        .intersection(frame)
        .simplify(0.00025, preserve_topology=True)
    )
    if g.is_empty:
        continue
    cls = f"cd cd-{cd}" + (" cd-board" if cd in BOARDS else "")
    paths.append(f'<path class="{cls}" d="{path(g)}"/>')
    if cd in BOARDS:
        x, y = xy(*g.representative_point().coords[0])
        labels.append(
            f'<text x="{x:.0f}" y="{y:.0f}" class="cd-label cd-label-{cd}">{int(cd) - 100}</text>'
        )

svg = (
    f'<svg class="cdmap" data-board="cb2" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" '
    f'aria-label="Map of lower Manhattan with Community Boards 2 and 3 outlined">'
    + "".join(paths)
    + "".join(labels)
    + "</svg>"
)
page = Path(__file__).resolve().parent.parent / "public" / "index.html"
html = page.read_text()
html, n = re.subn(
    r"<!-- district-map -->.*?<!-- /district-map -->",
    f"<!-- district-map -->{svg}<!-- /district-map -->",
    html,
    flags=re.S,
)
if n != 1:
    raise SystemExit(
        "public/index.html needs one <!-- district-map --><!-- /district-map --> pair"
    )
page.write_text(html)
print(f"{len(svg)} bytes, {len(paths)} districts, viewBox {WIDTH}x{HEIGHT}")
