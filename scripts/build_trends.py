"""Build public/dashboard/trends.json, everything the Trends page shows, from public records only:

  - data/311/cb2.csv (fetch_311.py): what was reported to 311 in the district and how agencies closed it
  - the D1 resolutions table (build_resolution_index.py, loaded locally): what the board decided, per tax lot
  - data/public_session.json + data/eval/ps_labels_{a,b}.json: what residents told the Full Board

    npx wrangler d1 execute DB --local --file data/resolutions.sql   # once
    uv run scripts/build_trends.py
"""

import csv
import json
import re
import subprocess
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

from eval_routing import sla_from_minutes  # the board's own SLA committee for a premises

ROOT = Path(__file__).resolve().parent.parent
CLASSES = [(c["key"], re.compile(c["pattern"], re.I)) for c in json.loads((ROOT / "worker" / "outcomes.json").read_text())["classes"]]
LABELS = {c["key"]: c["label"] for c in json.loads((ROOT / "worker" / "outcomes.json").read_text())["classes"]}


# 311 complaint types that bear on what each kind of board decision governs (a liquor license's
# stipulations are about noise and crowds; a Landmarks review is about the building, not the curb).
RELATED = {
    "SLA": {"Noise - Commercial", "Noise - Street/Sidewalk", "Noise", "Food Establishment", "Outdoor Dining", "Dirty Condition"},
    "Cannabis": {"Cannabis Retailer", "Smoking or Vaping", "Noise - Commercial"},
    "Street Activities": {"Obstruction", "Vendor Enforcement", "Outdoor Dining", "Noise - Street/Sidewalk"},
    "Landmarks": {"General Construction/Plumbing", "Building/Use", "Real Time Enforcement"},
}
related = lambda committee, t: any(committee.startswith(k) and t in v for k, v in RELATED.items())


def outcome(text: str) -> str:
    return next((k for k, p in CLASSES if p.search(text)), "other")


def resolutions_by_lot() -> dict[str, list[dict]]:
    out = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command",
         "SELECT id, bbl, address, committee, meeting_date, meeting_iso, title, outcome, stipulations, source FROM resolutions WHERE bbl IS NOT NULL"],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout
    by = defaultdict(list)
    for r in json.loads(out)[0]["results"]:
        r["stipulations"] = len(json.loads(r["stipulations"]))
        by[r["bbl"]].append(r)
    for rs in by.values():
        rs.sort(key=lambda r: r["meeting_iso"], reverse=True)
    return by


def street(a: str) -> str:
    return re.sub(r"\s+", " ", a).title().replace(" Street", " St").replace(" Avenue", " Ave")


def main() -> None:
    rows = list(csv.DictReader((ROOT / "data" / "311" / "cb2.csv").open()))
    for r in rows:
        r["day"] = date.fromisoformat(r["created_date"][:10])
    end = max(r["day"] for r in rows)
    age = lambda r: (end - r["day"]).days
    cur = [r for r in rows if age(r) < 30]
    prev = [r for r in rows if 30 <= age(r) < 60]
    c, p = Counter(r["complaint_type"] for r in cur), Counter(r["complaint_type"] for r in prev)

    def closed_mix(rs: list[dict]) -> dict:
        closed = [outcome(r["resolution_description"]) for r in rs if r["status"] == "Closed"]
        mix = Counter(k for k in closed if k != "other")
        return {"closed": len(closed), "outcomes": [{"key": k, "label": LABELS[k], "count": n} for k, n in mix.most_common()]}

    types = [{"type": t, "agency": next(r["agency"] for r in cur if r["complaint_type"] == t), "count": n, "prev": p[t],
              **closed_mix([r for r in cur if r["complaint_type"] == t])} for t, n in c.most_common(8)]

    # Weekly counts for 12 weeks, ending on the newest day in the file.
    def weekly(rs: list[dict]) -> list[dict]:
        weeks = Counter((age(r)) // 7 for r in rs if age(r) < 84)
        return [{"week": (end - timedelta(days=7 * w + 6)).isoformat(), "count": weeks[w]} for w in range(11, -1, -1)]

    risers = sorted((t for t in c if c[t] >= 40), key=lambda t: c[t] - p[t], reverse=True)[:3]
    rising = [{"type": t, "count": c[t], "prev": p[t], "weeks": weekly([r for r in rows if r["complaint_type"] == t])} for t in risers]

    # Where 311 and the board's record meet: busy lots (90 days) that the board has decided on.
    res = resolutions_by_lot()
    recent = [r for r in rows if age(r) < 90 and r["bbl"]]
    lots = Counter(r["bbl"] for r in recent)
    hotspots = []
    for bbl, n in lots.most_common():
        if bbl not in res or n < 20:
            continue
        here = [r for r in recent if r["bbl"] == bbl]
        top_type, top_n = Counter(r["complaint_type"] for r in here).most_common(1)[0]
        rel = any(related(x["committee"], top_type) for x in res[bbl])
        hotspots.append({
            "related": rel,
            "bbl": bbl, "address": street(Counter(r["incident_address"] for r in here).most_common(1)[0][0]), "count": n,
            "lat": float(here[0]["latitude"] or 0), "lng": float(here[0]["longitude"] or 0),
            "top": {"type": top_type, "count": top_n, "weeks": weekly([r for r in rows if r["bbl"] == bbl and r["complaint_type"] == top_type]),
                    "hours": Counter(int(r["created_date"][11:13]) for r in here if r["complaint_type"] == top_type).most_common(3),
                    **closed_mix([r for r in here if r["complaint_type"] == top_type])},
            "types": Counter(r["complaint_type"] for r in here).most_common(4),
            "resolutions": [{k: x[k] for k in ("id", "committee", "meeting_date", "title", "outcome", "stipulations", "source")} for x in res[bbl][:3]],
        })
    hotspots.sort(key=lambda h: (not h["related"], -h["count"]))
    hotspots = hotspots[:6]

    # What residents told the Full Board: remarks both raters called a concern, newest meetings first.
    ps = json.loads((ROOT / "data" / "public_session.json").read_text())
    la = {x["id"]: x for x in json.loads((ROOT / "data" / "eval" / "ps_labels_a.json").read_text())}
    lb = {x["id"]: x for x in json.loads((ROOT / "data" / "eval" / "ps_labels_b.json").read_text())}
    def committee(x: dict) -> str:
        c = la[x["id"]]["committee"]
        return sla_from_minutes(f"{x['topic']} {x['speaker_line']} {x['text']}", c) if c.startswith("SLA") else c
    voices = [{**{k: x[k] for k in ("id", "meeting_date", "topic", "speaker_line", "text", "source")}, "committee": committee(x)}
              for x in ps if la[x["id"]]["concern"] and lb[x["id"]]["concern"]]
    voices.sort(key=lambda x: x["id"], reverse=True)
    year = voices[0]["id"][:4]
    by_topic = Counter(v["committee"] for v in voices if v["id"].startswith(year))

    out = {
        "generated": date.today().isoformat(), "through": end.isoformat(),
        "source": "https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9",
        "district": "Manhattan Community District 2", "total30": len(cur), "prev30": len(prev), "total365": len(rows),
        "types": types, "rising": rising, "hotspots": hotspots,
        "voices": {"count": len(voices), "year": year, "meetings": len({v["meeting_date"] for v in voices}), "by_committee": by_topic.most_common(),
                   "latest": voices[:12]},
    }
    path = ROOT / "public" / "dashboard" / "trends.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(cur)} requests in the 30 days to {end}; {len(hotspots)} hotspots; {len(voices)} public-session concerns -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
