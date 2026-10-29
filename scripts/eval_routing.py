"""Run the routing test set through the running Worker's /api/route and score it.

Two kinds of cases, each labeled by someone other than the app:
  - 311: real CB2 service requests (sample_311_cases.py). 311 filed each under a complaint type; a
    writer who never saw the app wrote the resident's message (data/eval/311_messages.json). Right
    answer: our form for that complaint type, or, when none of ours covers it, not one of our 311 forms.
    The address 311 recorded is the answer for the place: its tax lot (BBL) from the 311 record.
  - Public Session: remarks residents made to the Full Board (parse_public_session.py), labeled
    concern / committee by two raters (data/eval/ps_labels_{a,b}.json). Cases where both say it is a
    concern and agree on the committee; right answer: the board (cb2) and that committee.

    npx wrangler dev --port 8787   # in another shell
    uv run scripts/eval_routing.py [http://localhost:8787]

Writes data/eval/results.json (every case with what the app answered) and public/eval.json (the scores, shown on /how).
"""

import csv
import json
import re
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"


def call(message: str) -> dict:
    req = urllib.request.Request(BASE + "/api/route", data=json.dumps({"message": message}).encode(),
                                 headers={"content-type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:  # a slow lookup or a 502 from Jev: try again, then record it
            err = str(e)
    return {"error": err}


def sla_from_minutes(text: str, rater: str) -> str:
    """The SLA committee the board itself sent this premises to, if a resolution names its address.

    The raters split SLA 1 / SLA 2 by a geography that turned out to be reversed (the minutes send
    SoHo/NoHo/Bowery mostly to SLA 1 and the West Village mostly to SLA 2), so with no record of the
    premises their call is flipped to the board's own default for that side of the district.
    """
    for m in re.finditer(r"\b(\d{1,4})\s+([A-Z][a-z]+)", text):
        hit = [r["committee"] for r in RESOLUTIONS if r["committee"].startswith("SLA")
               and re.search(rf"\b{m[1]}\s+{m[2]}", r["title"], re.I)]
        if hit:
            return Counter(hit).most_common(1)[0][0]
    return {"SLA – 1": "SLA – 2", "SLA – 2": "SLA – 1"}[rater]


NAMES = {k: "CB2 Manhattan" if k == "cb2" else f"311 {f['name']}" for k, f in json.loads((ROOT / "worker" / "catalog.json").read_text())["forms"].items()}
RESOLUTIONS = json.loads((ROOT / "data" / "resolutions.json").read_text())


def cases() -> list[dict]:
    bbl = {r["unique_key"]: r["bbl"] for r in csv.DictReader((ROOT / "data" / "311" / "cb2.csv").open())}
    msgs = {m["id"]: m for m in json.loads((EVAL / "311_messages.json").read_text())}
    out = []
    for c in json.loads((EVAL / "311_cases.json").read_text()):
        m = msgs[c["id"]]
        out.append({"id": c["id"], "kind": "311", "lang": m["lang"], "message": m["message"], "expected_form": c["expected_form"],
                    "complaint_type": c["complaint_type"], "bbl": bbl.get(c["id"][4:]) or None})
    ps = {p["id"]: p for p in json.loads((ROOT / "data" / "public_session.json").read_text())}
    a = json.loads((EVAL / "ps_labels_a.json").read_text())
    b = {x["id"]: x for x in json.loads((EVAL / "ps_labels_b.json").read_text())}
    for x in a:
        y = b[x["id"]]
        if x["concern"] and y["concern"] and x["committee"] == y["committee"]:
            p = ps[x["id"]]
            text = f"{p['topic']}: {p['text']}" if p["topic"] else p["text"]
            committee = x["committee"]
            if committee.startswith("SLA"):
                committee = sla_from_minutes(f"{p['topic']} {p['speaker_line']} {p['text']}", committee)
            out.append({"id": x["id"], "kind": "public_session", "lang": "en", "message": text[:4000],
                        "expected_form": "cb2", "expected_committee": committee, "rater_committee": x["committee"]})
    return out


def score(c: dict, r: dict) -> dict:
    if "error" in r or not r.get("forms"):
        return {**c, "error": r.get("error", "no forms")}
    top = r["forms"][0]
    cb2 = next(f for f in r["forms"] if f["key"] == "cb2")
    committee = next((f for f in cb2["fields"] if f["id"] == "committee"), None)
    picked = committee["options"][committee["selected"]]["value"] if committee and committee["selected"] is not None else None
    loc = next((f for f in r["general"] if f["id"] == "location"), None)
    place = loc["options"][loc["selected"]] if loc and loc["selected"] is not None else None
    # No form of ours covers it: right to send it to the board or to nothing, wrong to pick a 311 form that doesn't fit.
    form_ok = top["key"] == c["expected_form"] if c["expected_form"] else top["key"] == "cb2" or r["none"] > top["probability"]
    return {
        **c, "form": top["key"], "p": round(top["probability"], 3), "second": r["forms"][1]["key"], "none": round(r["none"], 3),
        "emergency": round(r["emergency"], 3), "form_ok": form_ok, "committee": picked,
        "committee_ok": picked == c.get("expected_committee") if c.get("expected_committee") else None,
        "place_bbl": place and place.get("geo", {}) and place["geo"].get("bbl"),
        "related": [x["id"] for x in r.get("related", [])][:3], "ms": r["jev"]["latencyMs"], "model": r["jev"]["model"],
    }


def rate(xs: list[bool]) -> dict:
    return {"n": len(xs), "correct": sum(xs), "accuracy": round(sum(xs) / len(xs), 3) if xs else None}


def main() -> None:
    cs = cases()
    with ThreadPoolExecutor(4) as pool:
        results = [score(c, r) for c, r in zip(cs, pool.map(lambda c: call(c["message"]), cs))]
    (EVAL / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n")
    ok = [r for r in results if "error" not in r]
    t311 = [r for r in ok if r["kind"] == "311"]
    ps = [r for r in ok if r["kind"] == "public_session"]
    # Place: of the 311 cases whose message names a place and whose request has a lot, did the app pick that lot?
    placed = [r for r in t311 if r["bbl"] and r["place_bbl"]]
    summary = {
        "model": Counter(r["model"] for r in ok).most_common(1)[0][0] if ok else None,
        "errors": len(results) - len(ok),
        "form_311_covered": rate([r["form_ok"] for r in t311 if r["expected_form"]]),
        "form_311_uncovered": rate([r["form_ok"] for r in t311 if not r["expected_form"]]),
        "form_311_by_lang": {l: rate([r["form_ok"] for r in t311 if r["lang"] == l]) for l in ("en", "es", "zh")},
        "form_public_session": rate([r["form_ok"] for r in ps]),
        "committee_public_session": rate([r["committee_ok"] for r in ps]),
        "place_bbl_311": {**rate([r["place_bbl"] == r["bbl"] for r in placed]), "of": len([r for r in t311 if r["bbl"]])},
        "false_emergency": sum(r["emergency"] >= 0.5 for r in ok),
        "latency_ms_p50": sorted(r["ms"] for r in ok)[len(ok) // 2] if ok else None,
        "confusion_311": Counter(f"{r['expected_form'] or 'none of ours'} -> {r['form']}" for r in t311 if not r["form_ok"]).most_common(),
        "confusion_committee": Counter(f"{r['expected_committee']} -> {r['committee']}" for r in ps if not r["committee_ok"]).most_common(),
        # A few real misses, for the /how page: what was written, what was right, what the app picked.
        "misses": [{"message": r["message"], "expected": NAMES.get(r["expected_form"]) or f"not one of our 311 forms (311 filed it as {r['complaint_type']})", "got": NAMES[r["form"]]}
                   for r in t311 if not r["form_ok"]][:4]
                  + [{"message": r["message"][:200], "expected": r["expected_committee"], "got": r["committee"]} for r in ps if not r["committee_ok"]][:2],
        "run": date.today().isoformat(),
    }
    # The /how page shows this file; data/eval/results.json has every case.
    (ROOT / "public" / "eval.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
