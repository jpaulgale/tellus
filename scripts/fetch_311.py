# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Download a year of 311 service requests in one community district from NYC Open Data
(dataset erm2-nwe9) into data/311/<board>.csv. Every count on the board dashboard comes from this file.

Usage: uv run scripts/fetch_311.py [board=cb2] [days=365]   (board: a key of worker/boards.json)
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
URL = "https://data.cityofnewyork.us/resource/erm2-nwe9.csv"
COLUMNS = (
    "unique_key,created_date,closed_date,agency,complaint_type,descriptor,location_type,incident_address,"
    "intersection_street_1,intersection_street_2,bbl,status,resolution_description,"
    "resolution_action_updated_date,open_data_channel_type,latitude,longitude"
)


def main() -> None:
    board = sys.argv[1] if len(sys.argv) > 1 else "cb2"
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 365
    district = json.loads((ROOT / "worker" / "boards.json").read_text())[board]["community_board_311"]
    OUT = ROOT / "data" / "311" / f"{board}.csv"
    since = (date.today() - timedelta(days=days)).isoformat()
    params = {
        "$select": COLUMNS,
        "$where": f"community_board='{district}' AND created_date >= '{since}'",
        "$order": "created_date",
        "$limit": 500000,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", URL, params=params, timeout=300) as r:
        r.raise_for_status()
        with OUT.open("wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    rows = sum(1 for _ in OUT.open()) - 1
    print(f"{rows} service requests since {since} in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
