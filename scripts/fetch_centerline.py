"""Download the street centerline for the area around Manhattan CB2 and write the corner nodes
per street label to worker/cscl.json, so intersections resolve without a network call.

Usage: uv run scripts/fetch_centerline.py
"""

import json
import urllib.parse
import urllib.request
from pathlib import Path

URL = "https://data.cityofnewyork.us/resource/inkn-q76z.json"
# A box around CB2 (14th St to Canal St, Hudson River to Bowery) with a margin.
WHERE = "boroughcode='1' AND within_box(the_geom, 40.745, -74.02, 40.705, -73.970)"

nodes: dict[str, list[list[float]]] = {}
offset = 0
while True:
    q = urllib.parse.urlencode({"$select": "stname_label,the_geom", "$where": WHERE, "$limit": 2000, "$offset": offset, "$order": "physicalid"})
    rows = json.load(urllib.request.urlopen(f"{URL}?{q}", timeout=60))
    for r in rows:
        for line in (r.get("the_geom") or {}).get("coordinates", []):
            if len(line) >= 2 and r.get("stname_label"):
                for x, y in (line[0], line[-1]):
                    nodes.setdefault(r["stname_label"], []).append([round(x, 6), round(y, 6)])
    if len(rows) < 2000:
        break
    offset += 2000

out = Path(__file__).resolve().parent.parent / "worker" / "cscl.json"
out.write_text(json.dumps(nodes, separators=(",", ":")))
print(f"{len(nodes)} streets, {sum(map(len, nodes.values()))} nodes, {out.stat().st_size // 1024} KB")
