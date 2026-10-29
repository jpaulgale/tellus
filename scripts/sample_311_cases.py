"""Draw the 311 part of the routing test set from data/311/cb2.csv (fetch_311.py).

311 already filed each of these requests under a complaint type, so the label comes from the city,
not from us. Draws 8 requests for each complaint type one of our forms covers, and 40 more, in
proportion to volume, from the types none of them covers (the right answer there is to not pick a
wrong 311 form). Writes data/eval/311_cases.json without the resident's words; a writer who never
sees the app's output adds a `message` per case.

Usage: uv run scripts/sample_311_cases.py
"""

import csv
import json
import random
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMS = json.loads((ROOT / "worker" / "catalog.json").read_text())["forms"]
# 311 complaint type -> our form key
COVERED = {f["complaint_type"]: k for k, f in FORMS.items() if k != "cb2"}
PER_COVERED, UNCOVERED = 8, 40


def main() -> None:
    rows = list(csv.DictReader((ROOT / "data" / "311" / "cb2.csv").open()))
    rng = random.Random(311)
    by_type: dict[str, list[dict]] = {}
    for r in rows:
        if r["incident_address"] or r["intersection_street_1"]:
            by_type.setdefault(r["complaint_type"], []).append(r)
    picked: list[dict] = []
    for t in COVERED:
        picked += rng.sample(by_type.get(t, []), min(PER_COVERED, len(by_type.get(t, []))))
    other = [r for t, rs in by_type.items() if t not in COVERED for r in rs]
    picked += rng.sample(other, UNCOVERED)
    cases = [
        {
            "id": f"311-{r['unique_key']}",
            "complaint_type": r["complaint_type"],
            "descriptor": r["descriptor"],
            "location_type": r["location_type"],
            "agency": r["agency"],
            "address": r["incident_address"] or f"{r['intersection_street_1']} and {r['intersection_street_2']}",
            "created_date": r["created_date"][:10],
            "expected_form": COVERED.get(r["complaint_type"]),  # None: no form of ours covers it
        }
        for r in picked
    ]
    out = ROOT / "data" / "eval" / "311_cases.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cases, indent=1) + "\n")
    print(f"{len(cases)} cases -> {out.relative_to(ROOT)}")
    print(Counter(c["expected_form"] or "(none of ours)" for c in cases))


if __name__ == "__main__":
    main()
