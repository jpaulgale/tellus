# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Turn data/resolutions.json into worker/resolutions.json: one compact record per resolution
that names an address, geocoded to its tax lot so a resident's location can be matched to it.

Usage: uv run scripts/build_resolution_index.py
"""

import json
import re
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
PDF_BASE = "https://cbmanhattan.cityofnewyork.us/cb2/wp-content/uploads/sites/9/"
PDF_PATH = {
    "04-April-2026-Full-Board-Minutes-final.pdf": "2026/05/",
    "05-May-2026-Full-Board-Minutes.pdf": "2026/06/",
    "06-June-2026-Full-Board-Minutes.pdf": "2026/07/",
    "DRAFT-07-July-2026-Full-Board-Minutes-Final-1.pdf": "2026/09/",
}
SUFFIX = r"(?:St|Street|Ave|Avenue|Pl|Place|Sq|Square|Ln|Lane|Blvd|Rd|Way|Broadway|Bowery|Slip|Alley)"
ADDRESS = re.compile(rf"\b(\d{{1,4}}(?:[-–]\d{{1,4}})?[A-Z]?\s+(?:[A-Za-z0-9.’']+\s+){{0,4}}?{SUFFIX}\b\.?(?:\s+[SNEW]\b)?)")


def stipulations(text: str) -> list[str]:
    """Numbered stipulations after 'stipulations as follows:' ('1. Will ...' through the last one)."""
    m = re.search(r"stipulations[^:\n]*as follows:?", text, re.I)
    if not m:
        return []
    body = text[m.end():]
    end = re.search(r"\n\s*(?:[ivx]+\.\s+Whereas|THEREFORE)", body)
    body = body[: end.start()] if end else body
    items = re.split(r"\n\s*\d{1,2}\.\s+", "\n" + body)
    return [re.sub(r"\s+", " ", i).strip() for i in items if len(i.strip()) > 8]


def applicant(title: str, address: str) -> tuple[str, str]:
    """('Legal name', 'dba') from 'Legal LLC dba Trade Name 12 Main St 10012 (OP–Tavern)'."""
    head = title.split(address)[0].strip(" *–-")
    legal, _, dba = head.partition(" dba ")
    return legal.strip(), dba.strip()


def main() -> None:
    out = []
    with httpx.Client(timeout=15) as client:
        for r in json.loads((ROOT / "data" / "resolutions.json").read_text()):
            m = ADDRESS.search(r["title"])
            if not m:
                continue
            address = m.group(1).strip()
            g = client.get("https://geosearch.planninglabs.nyc/v2/search",
                           params={"text": f"{address}, Manhattan", "size": 1,
                                   "focus.point.lat": 40.7265, "focus.point.lon": -74.0}).json()
            feat = (g.get("features") or [None])[0]
            if not feat or feat["properties"].get("borough") != "Manhattan":
                continue
            p = feat["properties"]
            legal, dba = applicant(r["title"], address)
            kind = re.search(r"\(([^)]*)\)", r["title"])
            out.append({
                "id": r["id"], "meeting_date": r["meeting_date"], "committee": r["committee"],
                "title": r["title"], "address": address, "legal_name": legal, "dba": dba,
                "license_type": kind.group(1) if kind else "",
                "outcome": r["outcome"], "vote": r["vote"],
                "bbl": (p.get("addendum") or {}).get("pad", {}).get("bbl"),
                "lat": feat["geometry"]["coordinates"][1], "lng": feat["geometry"]["coordinates"][0],
                "stipulations": stipulations(r["text"]),
                "source": PDF_BASE + PDF_PATH.get(r["source_pdf"], "") + r["source_pdf"],
            })
    (ROOT / "worker" / "resolutions.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    with_stips = sum(1 for o in out if o["stipulations"])
    print(f"{len(out)} resolutions with an address ({with_stips} with stipulations), {(ROOT / 'worker' / 'resolutions.json').stat().st_size // 1024} KB")
    r = next(o for o in out if o["id"] == "04-015")
    print(r["address"], r["bbl"], "|", r["legal_name"], "|", r["dba"], "|", r["license_type"], "|", len(r["stipulations"]), "stips |", r["stipulations"][7])


if __name__ == "__main__":
    main()
