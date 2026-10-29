"""Pull the Public Session out of each Full Board minutes text file (fetch_minutes.py): what
residents and groups told the board in their own words, as the secretary recorded it.

Each item is one speaker's remarks: the topic heading they spoke under (when there is one), the
speaker line, and their bullet points. Writes data/public_session.json.

Usage: uv run scripts/parse_public_session.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MINUTES = ROOT / "data" / "minutes"
SOURCES = json.loads((MINUTES / "sources.json").read_text())
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"

START = re.compile(r"^\f?\s*PUBLIC SESSION\s*$", re.IGNORECASE)
END = re.compile(r"^\f?\s*(ADOPTION OF (THE )?AGENDA|ELECTED OFFICIALS|BUSINESS SESSION)", re.IGNORECASE)
BULLET = re.compile(r"^\s*[•●▪◦\-–]\s+|^\s*[o]\s{2,}")
PAGE_NUM = re.compile(r"^\f?\s*\d{1,3}\s*$")


def meeting_date(text: str) -> str:
    m = re.search(rf"DATE:\s*((?:{MONTHS}) \d+, \d{{4}})", text)
    return m.group(1) if m else ""


def blocks(lines: list[str]) -> list[tuple[str, list[str]]]:
    """(heading, bullets) pairs. A heading is a non-bullet line after a blank line or after bullets."""
    out: list[tuple[str, list[str]]] = []
    head: list[str] = []
    bullets: list[str] = []
    prev_blank = True
    for raw in lines:
        line = raw.replace("\f", "").rstrip()
        if PAGE_NUM.match(line):
            continue
        if not line.strip():
            prev_blank = True
            continue
        if BULLET.match(line):
            bullets.append(BULLET.sub("", line).strip())
        elif bullets and not prev_blank and line.startswith(" "):
            bullets[-1] += " " + line.strip()  # a bullet's wrapped line
        elif bullets or (head and prev_blank):
            out.append((" ".join(head), bullets))
            head, bullets = [line.strip()], []
        else:
            head.append(line.strip())  # a heading that wraps
        prev_blank = False
    if head or bullets:
        out.append((" ".join(head), bullets))
    return out


def parse(path: Path) -> list[dict]:
    text = path.read_text()
    lines = text.splitlines()
    starts = [i for i, l in enumerate(lines) if START.match(l)]
    if not starts:
        return []
    i = starts[-1]  # the first is the table of contents' entry when it has no dot leader
    j = next((k for k in range(i + 1, len(lines)) if END.match(lines[k])), len(lines))
    date = meeting_date(text)
    pdf = path.with_suffix(".pdf").name
    items, topic = [], ""
    for head, bullets in blocks(lines[i + 1 : j]):
        if not bullets:
            # A heading with nothing under it is a topic that the next speakers spoke under ("Re Redesign of …"),
            # unless it is a whole remark in one line ("Board success advocating for … - Jeannine Kiely").
            if " - " in head or ":" in head[:-1]:
                items.append({"topic": topic, "speaker_line": head, "text": head})
            else:
                topic = re.sub(r"^Re:?\s+", "", head)
            continue
        items.append({"topic": topic, "speaker_line": head, "text": " ".join(bullets)})
    for n, it in enumerate(items, 1):
        it.update(id=f"{meeting_iso(date)}-ps{n:02d}", meeting_date=date, source=SOURCES.get(pdf, ""))
    return items


def meeting_iso(date: str) -> str:
    month, _, year = date.partition(" ")
    return f"{year[-4:]}-{MONTHS.split('|').index(month) + 1:02d}"


def main() -> None:
    items = [it for p in sorted(MINUTES.glob("*.txt")) for it in parse(p)]
    items.sort(key=lambda x: x["id"])
    out = ROOT / "data" / "public_session.json"
    out.write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n")
    meetings = len({x["meeting_date"] for x in items})
    print(f"{len(items)} public-session remarks from {meetings} meetings -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
