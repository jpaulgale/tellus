"""Sample resolutions to turn into resident requests for the committee test (eval_resolutions.py).

Up to PER resolutions from each committee, at random with a fixed seed, so the small committees are in
the test and not only SLA. Writes data/eval/resolution_cases.json (with the committee: the answer) and
data/eval/resolution_prompts_<board>.json (without it: what the writers see).

    uv run scripts/sample_resolution_cases.py
"""

import json
import random
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval"
PER = 15
BOARDS = {"cb2": ROOT / "data" / "resolutions.json", "cb3": ROOT / "data" / "cb3" / "resolutions.json"}


def main() -> None:
    cases = []
    for board, path in BOARDS.items():
        committees = json.loads((ROOT / "worker" / "boards.json").read_text())[board]["committees"]
        by = defaultdict(list)
        for r in json.loads(path.read_text()):
            if r["committee"] in committees:  # not task forces outside the board's committee list
                by[r["committee"]].append(r)
        rng = random.Random(f"{board}-resolutions")
        picked = [r for c in sorted(by) for r in rng.sample(by[c], min(PER, len(by[c])))]
        rng.shuffle(picked)  # so the writers don't see the committees in runs
        for r in picked:
            cases.append({"id": f"{board}-{r['id']}", "board": board, "resolution_id": r["id"] if board == "cb2" else f"{board}-{r['id']}",
                          "committee": r["committee"], "meeting_iso": datetime.strptime(r["meeting_date"], "%B %d, %Y").date().isoformat(),
                          "title": r["title"], "text": r["text"]})
        prompts = [{"id": c["id"], "meeting_date": c["meeting_iso"], "title": c["title"], "text": c["text"][:2500]} for c in cases if c["board"] == board]
        (EVAL / f"resolution_prompts_{board}.json").write_text(json.dumps(prompts, ensure_ascii=False, indent=1) + "\n")
        print(board, len(prompts), {c: min(PER, len(v)) for c, v in sorted(by.items())})
    (EVAL / "resolution_cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
