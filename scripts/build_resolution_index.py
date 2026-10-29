# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Turn data/resolutions.json into data/resolutions.sql for the D1 resolutions tables: every
resolution with its full text for search, geocoded to its tax lot when it names an address.

Usage: uv run scripts/build_resolution_index.py [cb3]   (cb3: data/cb3/, from parse_minutes_cb3.py)
"""

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
BOARD = sys.argv[1] if len(sys.argv) > 1 else "cb2"
DATA = ROOT / "data" if BOARD == "cb2" else ROOT / "data" / BOARD
SOURCES = json.loads(
    (DATA / "minutes" / "sources.json").read_text()
)  # PDF name -> URL (fetch_minutes.py, parse_minutes_cb3.py)
# Where GeoSearch should look first: the middle of the district.
FOCUS = {"cb2": (40.7265, -74.0), "cb3": (40.7200, -73.9870)}[BOARD]
SUFFIX = r"(?:Ave(?:nue|\.)? of the Americas|Ave(?:nue)? [A-D]\b|St\.? Mark'?s Pl(?:ace)?|St|Street|Ave|Avenue|Pl|Place|Sq|Square|Ln|Lane|Blvd|Rd|Way|Broadway|B'way|Bowery|Slip|Alley)"
# "12 Main St", "90-92 Bowery", "55-1/2 Greene St", "401 Ave of the Americas"
ADDRESS = re.compile(
    rf"(?<!Board )\b(\d{{1,4}}(?:[-–]\d{{1,4}})?(?:-1/2|½)?[A-Z]?\s+(?:[A-Za-z0-9.’']+\s+){{0,4}}?{SUFFIX}\b\.?(?:\s+[SNEW]\b)?)"
)


def stipulations(text: str) -> list[str]:
    """Numbered stipulations after 'stipulations as follows:' ('1. Will ...' through the last one)."""
    m = re.search(r"stipulations[^:\n]*as follows:?", text, re.IGNORECASE)
    if not m:
        # CB3: "…unless the applicant agrees to the following signed notarized stipulations that 1) it will …"
        m = re.search(r"stipulations\s+that\s*(?=\n?\s*1\))", text, re.IGNORECASE)
        if not m:
            return []
        items = re.split(r"\n\s*\d{1,2}\)\s+", "\n" + text[m.end():].lstrip(" "))
        end = re.compile(r"\n\s*\n\s*(?:THEREFORE|Vote|\d{1,2}\.\s)")
        items = [end.split(i)[0] for i in items]
        return [re.sub(r"\s+", " ", i).strip().rstrip(",") for i in items if len(i.strip()) > 8]
    body = text[m.end() :]
    end = re.search(r"\n\s*(?:[ivx]+\.\s+Whereas|THEREFORE)", body)
    body = body[: end.start()] if end else body
    items = re.split(r"\n\s*\d{1,2}\.\s+", "\n" + body)
    return [re.sub(r"\s+", " ", i).strip() for i in items if len(i.strip()) > 8]


def applicant(title: str, address: str) -> tuple[str, str]:
    """('Legal name', 'dba') from 'Legal LLC dba Trade Name 12 Main St 10012 (OP–Tavern)'."""
    head = title.split(address)[0].strip(" *–-")
    legal, _, dba = head.partition(" dba ")
    return legal.strip(), dba.strip()


def geocode(client: httpx.Client, address: str) -> dict | None:
    g = client.get(
        "https://geosearch.planninglabs.nyc/v2/search",
        params={
            "text": f"{address}, Manhattan",
            "size": 1,
            "focus.point.lat": FOCUS[0],
            "focus.point.lon": FOCUS[1],
        },
    ).json()
    feat = (g.get("features") or [None])[0]
    return feat if feat and feat["properties"].get("borough") == "Manhattan" else None


def sql(v: object) -> str:
    """A SQLite literal."""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main() -> None:
    # "FYI / RENEWALS" is a list of license renewals the board didn't vote on one by one, "THE FOLLOWING ARE…" heads a group of them, and a
    # title starting in lowercase is the tail of a vote line the parser split off, not a resolution.
    resolutions = [
        r
        for r in json.loads((DATA / "resolutions.json").read_text())
        if not r["title"].upper().startswith(("FYI", "THE FOLLOWING ARE"))
        and not r["title"][:1].islower()
    ]
    addresses = [
        m.group(1).strip() if (m := ADDRESS.search(r["title"])) else None
        for r in resolutions
    ]
    with httpx.Client(timeout=15) as client, ThreadPoolExecutor(8) as pool:
        feats = list(pool.map(lambda a: geocode(client, a) if a else None, addresses))
    rows, fts = [], []
    for r, address, feat in zip(resolutions, addresses, feats):
        # Every resolution is searchable; only the ones we could place get a spot on the map.
        p = feat["properties"] if feat else {}
        legal, dba = applicant(r["title"], address) if address else ("", "")
        kind = re.search(r"\(([^)]*)\)", r["title"])
        lng, lat = feat["geometry"]["coordinates"] if feat else (None, None)
        row = {
            "id": r["id"],
            "meeting_date": r["meeting_date"],
            "meeting_iso": datetime.strptime(r["meeting_date"], "%B %d, %Y")
            .date()
            .isoformat(),
            "committee": r["committee"],
            "title": r["title"],
            "address": address if feat else None,
            "legal_name": legal,
            "dba": dba,
            "license_type": kind.group(1) if kind else "",
            "outcome": r["outcome"],
            "vote": r["vote"],
            "bbl": (p.get("addendum") or {}).get("pad", {}).get("bbl"),
            "lat": lat,
            "lng": lng,
            "stipulations": json.dumps(stipulations(r["text"]), ensure_ascii=False),
            "source": SOURCES[r["source_pdf"]],
        }
        rows.append(row)
        fts.append((r["id"], r["title"], dba, address, r["committee"], r["text"]))
    cols = ", ".join(rows[0])
    lines = ["DELETE FROM resolutions;", "DELETE FROM resolutions_fts;"]
    lines += [
        f"INSERT INTO resolutions ({cols}) VALUES ({', '.join(sql(v) for v in row.values())});"
        for row in rows
    ]
    lines += [
        f"INSERT INTO resolutions_fts (id, title, dba, address, committee, body) VALUES ({', '.join(sql(v) for v in f)});"
        for f in fts
    ]
    out = DATA / "resolutions.sql"
    out.write_text("\n".join(lines) + "\n")
    placed = sum(1 for row in rows if row["lat"] is not None)
    print(
        f"{len(rows)} resolutions ({placed} on the map), {out.stat().st_size // 1024} KB -> {out.relative_to(ROOT)}"
    )
    print(
        f"Load: npx wrangler d1 execute DB --local --file {out.relative_to(ROOT)}  (or --remote)"
    )


if __name__ == "__main__":
    main()
