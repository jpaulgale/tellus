"""Build public/dashboard/data/<board>/requests.json: the requests on the board dashboard, real Public Session remarks.

Each request goes through the running Worker the same way a resident's would: /api/route for the
committee Jev suggests, /api/geosearch for the address the resident confirmed, and /api/record for
what the board already decided there (resolutions, stipulations, related minutes).

    npx wrangler dev --port 8787   # in another shell
    uv run scripts/build_dashboard_data.py [http://localhost:8787] [board=cb2]
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"

# Real remarks from the Full Board's Public Session (parse_public_session.py), in the secretary's
# words, and the place each one is about. The titles are ours.
BOARD = sys.argv[2] if len(sys.argv) > 2 else "cb2"
PS = {x["id"]: x for x in json.loads((ROOT / "data" / ("public_session.json" if BOARD == "cb2" else f"{BOARD}/public_session.json")).read_text())}
PICKS = {"cb2": [
    ("2026-05-ps40", "Business using outdoor space it agreed not to use", "15 E 13th St"),
    ("2026-05-ps31", "Bass and traffic from a proposed event space", "45 Howard St"),
    ("2025-05-ps02", "Club crowds and cars from 2 to 5 am", "281 Lafayette St"),
    ("2026-03-ps05", "Smoking provisions in a café's liquor license", "110 Thompson St"),
    ("2026-05-ps04", "Two-way bike lane near Grace Church School", "Grace Church School"),
    ("2026-01-ps02", "Off-leash morning hours in Washington Square Park", "Washington Square Park"),
], "cb3": [
    ("2026-06-ps02", "Customers crowding the sidewalk on East 7th St", "93 E 7th St"),  # GeoSearch reads "93 1/2" as 184 1/2
    ("2026-04-ps02", "Bike corral blocking storefronts on 1st Ave", "1st Ave and E 11th St"),
    ("2026-01-ps01", "Canal St redesign cuts loading and patient drop-off", "Canal St and Mott St"),
    ("2026-06-ps04", "Worries about the East 3rd St intake center", "8 E 3rd St"),
    ("2026-05-ps01", "A community green space at the empty lot on 2nd Ave", "112 2nd Ave"),
    ("2026-05-ps04", "Banks left out of the Chatham Square Plaza design", "Chatham Square"),
]}[BOARD]
REQUESTS = [
    {"id": i, "title": title, "place": place, "message": PS[i]["text"], "speaker": PS[i]["speaker_line"].rstrip(":"),
     "received": PS[i]["meeting_date"], "source": PS[i]["source"]}
    for i, title, place in PICKS
]


def call(path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={"content-type": "application/json", "x-board": BOARD})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def words(text: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z]{4,}", text.lower())}


def by_overlap(message: str, resolutions: list) -> list:
    """The address's resolutions: one Jev tied a stipulation of to the complaint first, then the one whose wording shares most with it."""
    said = words(message)
    return sorted(resolutions, key=lambda r: (bool(r.get("relevant")), len(said & words(r["title"] + " " + " ".join(r["stipulations"]))), r["meeting_iso"]), reverse=True)


def committee(route: dict, resolutions: list) -> dict | None:
    """The committee that decided the closest-matching resolution here, else the one Jev picks on the board's form."""
    if resolutions:
        top = resolutions[0]
        return {"name": top["committee"], "why": f"It reviewed this address on {top['meeting_date']}."}
    cb2 = next((f for f in route["forms"] if f["key"] == "cb2"), None)
    field = next((f for f in cb2["fields"] if f["id"] == "committee"), None) if cb2 else None
    if not field or not field.get("options"):
        return None
    top = max(field["options"], key=lambda o: o["p"])
    return {"name": top["value"], "p": round(top["p"], 2), "why": top.get("note")}


def build(r: dict) -> dict:
    route = call("/api/route", {"message": r["message"]})
    [place, *_] = call("/api/geosearch?text=" + urllib.parse.quote(r["place"]))
    geo = place["geo"]
    rec = call("/api/record", {"message": r["message"], "geo": geo})
    rec["resolutions"] = by_overlap(r["message"], rec["resolutions"])
    top = route["forms"][0]
    out = {
        **{k: v for k, v in r.items() if k != "place"},
        "form": {"key": top["key"], "name": top["name"], "agency": top["agency"]},
        "committee": committee(route, rec["resolutions"]),
        "address": place["key"],
        "geo": {k: geo.get(k) for k in ("lat", "lng", "zip", "bbl", "corner") if geo.get(k) is not None},
        "resolutions": rec["resolutions"],
        "related": rec["related"],
    }
    print(f"{r['id']}: {top['key']} · {out['committee'] and out['committee']['name']} · {out['address']} · "
          f"{len(rec['resolutions'])} resolutions, {len(rec['related'])} related")
    return out


def main():
    out = ROOT / "public" / "dashboard" / "data" / BOARD / "requests.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([build(r) for r in REQUESTS], ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
