"""Split CB2 Full Board minutes (pdftotext -layout output) into resolutions.

Usage: uv run scripts/parse_minutes.py  -> writes data/resolutions.json
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MINUTES = ROOT / "data" / "minutes"

# Minutes header text -> canonical committee name from data/committees.json
HEADERS = [
    (r"EXECUTIVE COMMITTEE", "Executive Committee"),
    (r"CANNABIS.*", "Cannabis Licensing Committee"),
    (r"HUMAN SERVICES.*", "Human Services"),
    (r"LAND USE.*", "Land Use & Housing"),
    (r"LANDMARKS.*", "Landmarks & Public Aesthetics"),
    (r"SLA 1 LICENSING", "SLA – 1"),
    (r"SLA 2 LICENSING", "SLA – 2"),
    (r"PARKS (AND|&) WATERFRONT", "Parks & Waterfront"),
    (r"STREET ACTIVITIES.*", "Street Activities & Resiliency"),
    (r"SCHOOLS.*", "Schools & Education"),
    (r"TRAFFIC (AND|&) TRANSPORTATION", "Traffic & Transportation"),
]
HEADER_RES = [(re.compile(rf"^\s*{p}\s*$"), name) for p, name in HEADERS]
VOTE_RE = re.compile(r"^\s*Vote:\s*(.*)", re.IGNORECASE)
CLAUSE_RE = re.compile(r"^[A-Z]\.\s")
TITLE_RE = re.compile(r"^\s*(\d+)\.\s+(.*)")
PAGE_NUM_RE = re.compile(r"^\s*\d+\s*$")
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"


def meeting_date(text: str) -> str:
    m = re.search(rf"DATE:\s*((?:{MONTHS}) \d+, \d{{4}})", text)
    return m.group(1) if m else ""


def meeting_month(date: str) -> str:
    """'April 23, 2026' -> '2026-04'."""
    month, _, year = date.partition(" ")
    return f"{year[-4:]}-{MONTHS.split('|').index(month) + 1:02d}"


def outcome(body: str) -> str:
    b = body.upper()
    if "RECOMMENDS DENIAL" in b and "UNLESS" in b:
        return "deny-unless (stipulations)"
    if "RECOMMENDS DENIAL" in b or "DENIAL" in b:
        return "deny"
    if "APPROV" in b or "SUPPORT" in b:
        return "approve/support"
    return "other"


def parse(path: Path) -> list[dict]:
    text = path.read_text()
    date = meeting_date(text)
    # The headings on their own lines, not the table of contents (which also lists "WITHOUT RESOLUTIONS").
    start = re.search(
        r"^\s*STANDING COMMITTEE REPORTS? WITH RESOLUTIONS\s*$", text, re.MULTILINE
    )
    lines = text[start.start() :].splitlines() if start else []
    committee, buf, out = None, [], []
    for line in lines:
        if "WITHOUT RESOLUTION" in line:
            break
        hdr = next((n for r, n in HEADER_RES if r.match(line)), None)
        if hdr:
            committee, buf = hdr, []
            continue
        if PAGE_NUM_RE.match(line):
            continue
        buf.append(line.strip())
        if (vm := VOTE_RE.match(line)) and committee:
            body = "\n".join(buf).strip()
            first = next((b for b in buf if b), "")
            tm = TITLE_RE.match(first)
            title = tm.group(2) if tm else first
            # The title wraps onto the following lines, numbered or not, until a blank line or
            # the start of the body ("Whereas", "i.", or a lettered clause like "A. The property").
            i = buf.index(first) + 1
            while (
                i < len(buf)
                and buf[i]
                and not buf[i].lower().startswith(("whereas", "i."))
                and not CLAUSE_RE.match(buf[i])
                and not TITLE_RE.match(
                    buf[i]
                )  # the next item in a list voted on together
            ):
                title += " " + buf[i]
                i += 1
            title = re.sub(r"\s+", " ", title).strip()
            if len(title) > 300:
                title = title[:300].rsplit(" ", 1)[0] + "…"
            out.append(
                {
                    "id": f"{meeting_month(date)}-{len(out) + 1:03d}",
                    "meeting_date": date,
                    "committee": committee,
                    "title": title,
                    "outcome": outcome(body),
                    "vote": vm.group(1).strip(),
                    "text": re.sub(r"[ \t]+", " ", body),
                    "source_pdf": path.with_suffix(".pdf").name,
                }
            )
            buf = []
    return out


def main() -> None:
    resolutions = [r for p in sorted(MINUTES.glob("*.txt")) for r in parse(p)]
    (ROOT / "data" / "resolutions.json").write_text(
        json.dumps(resolutions, indent=2, ensure_ascii=False)
    )
    by = {}
    for r in resolutions:
        by[r["committee"]] = by.get(r["committee"], 0) + 1
    print(f"{len(resolutions)} resolutions")
    for k, v in sorted(by.items(), key=lambda kv: -kv[1]):
        print(f"  {v:3d}  {k}")


if __name__ == "__main__":
    main()
