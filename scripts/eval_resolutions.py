"""Does a resident's request reach the committee that took up the issue? Scored against the minutes.

Cases are real resolutions (sample_resolution_cases.py), up to 15 per committee per board. A writer
who saw the resolution but not its committee wrote the resident's message
(data/eval/resolution_messages_<board>.json). Right answer: the board's form and the committee the
minutes list. Each case runs twice:
  - before: the app's record of the board stops the day before that meeting (`before` on /api/route),
    as if the resident wrote while the item was pending. The resolution itself can't give the answer.
  - after: the whole record, including that resolution. Also scored: did the app show it?

Because the sample has as many SLA cases as Parks cases, the headline is weighted by how often
each committee comes up in the board's minutes; "always the most common committee" is the baseline.

    npx wrangler dev --port 8787   # in another shell
    uv run scripts/eval_resolutions.py [http://localhost:8787]

Writes data/eval/resolution_results.json (every case) and public/eval_resolutions.json (the scores).
"""

import json
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"
MINUTES = {"cb2": ROOT / "data" / "resolutions.json", "cb3": ROOT / "data" / "cb3" / "resolutions.json"}


def call(board: str, message: str, before: str | None) -> dict:
    body = {"message": message, **({"before": before} if before else {})}
    req = urllib.request.Request(BASE + "/api/route", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", "x-board": board})
    err = ""
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:  # a slow lookup or a 502 from Jev: try again, then record it
            err = str(e)
    return {"error": err}


def score(c: dict, mode: str, r: dict) -> dict:
    out = {"id": c["id"], "board": c["board"], "mode": mode, "expected": c["committee"], "message": c["message"]}
    if "error" in r or not r.get("forms"):
        return {**out, "error": r.get("error", "no forms")}
    board = next(f for f in r["forms"] if f["key"] == "cb2")  # the board's form; its key is the same for every board
    field = next((f for f in board["fields"] if f["id"] == "committee"), None)
    picked = field["options"][field["selected"]]["value"] if field and field["selected"] is not None else None
    loc = next((f for f in r["general"] if f["id"] == "location"), None)
    shown = {x["id"] for x in r.get("related", [])} | {x["id"] for o in (loc["options"] if loc else []) for x in (o.get("resolutions") or []) + (o.get("related") or [])}
    return {**out, "form": r["forms"][0]["key"], "form_ok": r["forms"][0]["key"] == "cb2", "committee": picked,
            "committee_ok": picked == c["committee"], "by_address": bool(field and field.get("reason")), "shown_own": c["resolution_id"] in shown}


def summarize(rs: list[dict], board: str) -> dict:
    share = Counter(r["committee"] for r in json.loads(MINUTES[board].read_text()))
    by = {}
    for r in rs:
        by.setdefault(r["expected"], []).append(r["committee_ok"])
    per = {c: {"n": len(v), "correct": sum(v), "accuracy": round(sum(v) / len(v), 3), "share": round(share[c] / sum(share[k] for k in by), 3)}
           for c, v in sorted(by.items(), key=lambda kv: -share[kv[0]])}
    top = max(per, key=lambda c: per[c]["share"])
    return {
        "n": len(rs), "form_board": round(sum(r["form_ok"] for r in rs) / len(rs), 3),
        "committee_sample": round(sum(r["committee_ok"] for r in rs) / len(rs), 3),
        "committee_weighted": round(sum(p["accuracy"] * p["share"] for p in per.values()), 3),
        "committee_macro": round(sum(p["accuracy"] for p in per.values()) / len(per), 3),
        "baseline_weighted": {"committee": top, "accuracy": per[top]["share"]},
        "shown_own": round(sum(r["shown_own"] for r in rs) / len(rs), 3),
        "by_committee": per,
        "confusion": Counter(f"{r['expected']} -> {r['committee']}" for r in rs if not r["committee_ok"]).most_common(8),
    }


def main() -> None:
    cases = json.loads((EVAL / "resolution_cases.json").read_text())
    msgs = {m["id"]: m["message"] for b in MINUTES for m in json.loads((EVAL / f"resolution_messages_{b}.json").read_text())}
    cases = [{**c, "message": msgs[c["id"]]} for c in cases]
    runs = [(c, mode) for c in cases for mode in ("before", "after")]
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda x: score(x[0], x[1], call(x[0]["board"], x[0]["message"], x[0]["meeting_iso"] if x[1] == "before" else None)), runs))
    (EVAL / "resolution_results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n")
    ok = [r for r in results if "error" not in r]
    summary = {"run": date.today().isoformat(), "errors": len(results) - len(ok),
               **{b: {m: summarize([r for r in ok if r["board"] == b and r["mode"] == m], b) for m in ("before", "after")} for b in MINUTES}}
    (ROOT / "public" / "eval_resolutions.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({b: {m: {k: v for k, v in s.items() if k not in ("by_committee", "confusion")} for m, s in summary[b].items()} for b in MINUTES}, indent=1))


if __name__ == "__main__":
    main()
