"""Build public/dashboard/requests.json: the sample requests on the board dashboard.

Each request goes through the running Worker the same way a resident's would: /api/route for the
committee Jev suggests, /api/geosearch for the address the resident confirmed, and /api/record for
what the board already decided there (resolutions, stipulations, related minutes).

    npx wrangler dev --port 8787   # in another shell
    uv run scripts/build_dashboard_data.py [http://localhost:8787]
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"

# What residents sent, and the place each one confirmed on the form.
REQUESTS = [
    {
        "id": "ps41",
        "title": "Cars speeding near P.S. 41 on West 11th Street",
        "message": "Cars speed through the intersection by P.S. 41 on West 11th Street during school drop-off and pickup. "
        "We need a crossing guard, clearer signs, or a speed camera.",
        "place": "116 W 11th St",
        "school": "P.S. 41 Greenwich Village School",
        "hours_ago": 216,
        "urgent": True,
    },
    {
        "id": "caudalie",
        "title": "Late-night music at Caudalie",
        "message": "Caudalie on 130 Greene St plays music past midnight every weekend. I can hear the bass in my apartment upstairs. "
        "I want the board to hold them to their license conditions.",
        "place": "130 Greene St",
        "hours_ago": 192,
        "urgent": True,
    },
    {
        "id": "church-bins",
        "title": "Garbage bins taking over the sidewalk at 232 W 11th St",
        "message": "The garbage bins in front of the church at 232 W 11th St take up half the sidewalk and smell in the summer. "
        "Was this enclosure ever approved?",
        "place": "232 W 11th St",
        "hours_ago": 26,
    },
    {
        "id": "carmine",
        "title": "Outdoor dining shed blocking the sidewalk",
        "message": "The dining shed at Bleecker St and Carmine St blocks most of the sidewalk. Strollers and wheelchairs have to go into the street. "
        "The board should not approve it again.",
        "place": "Bleecker St and Carmine St",
        "hours_ago": 20,
    },
    {
        "id": "wsp",
        "title": "Keep Washington Square Park open later in summer",
        "message": "Washington Square Park should stay open later at night in the summer. It's the only green space to sit in in the neighborhood.",
        "place": "Washington Square Park",
        "hours_ago": 3,
    },
]


def call(path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def words(text: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z]{4,}", text.lower())}


def by_overlap(message: str, resolutions: list) -> list:
    """The address's resolutions, the one whose wording shares most with the message first."""
    said = words(message)
    return sorted(resolutions, key=lambda r: (len(said & words(r["title"] + " " + " ".join(r["stipulations"]))), r["meeting_iso"]), reverse=True)


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
    out = ROOT / "public/dashboard/requests.json"
    out.write_text(json.dumps([build(r) for r in REQUESTS], ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
