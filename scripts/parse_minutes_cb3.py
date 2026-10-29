# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Manhattan Community Board 3's Full Board minutes -> the same records CB2's parsers produce.

CB3 posts its minutes on nyc.gov, not the cbmanhattan WordPress site, and writes them differently:
each committee report is a numbered agenda list where every item has a status line under it
("administratively approved", "withdrawn", or "VOTE: TITLE: …" followed by the resolution), and the
Full Board's tally for the committee ("33 YES 0 NO 1 ABS 0 PNV MOTION PASSED") comes after the list.
Public Session is "Name: what they said" paragraphs between "Public Session:" and "Public Officials:".

Writes data/cb3/resolutions.json (the schema of data/resolutions.json) and data/cb3/public_session.json
(the schema of data/public_session.json); the PDFs and text go in data/cb3/minutes/.

Usage: uv run scripts/parse_minutes_cb3.py [months=20]
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cb3"
MINUTES = OUT / "minutes"
SITE = "https://www.nyc.gov"
PAGE = SITE + "/site/manhattancb3/minutes/meeting-vote-records.page"
PDF = re.compile(r'href="(/assets/manhattancb3/downloads/minutes/\d{4}/minutes(\d{4})-(\d{2})\.pdf)"')
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"

# CB3's committees as its minutes name them (data/cb3/committees.json has the short names).
COMMITTEE = re.compile(r"^(?!Items\b)(?P<name>[A-Z][A-Za-z,&/ ]+(?:Committee|Task Force|Panel))\s*$")
# One name per committee: the minutes add the month ("August SLA …") and rename some over time.
CANON = [
    (r"\bSLA\b", "SLA Licensing & Outdoor Dining"),
    (r"^Transportation", "Transportation, Public Safety, Sanitation & Environment"),
    (r"^Cannabis", "Cannabis Control Task Force"),
    (r"^Health", "Health, Seniors & Human Services / Youth, Education & Human Rights"),
]


def canon(name: str) -> str:
    name = re.sub(rf"^(?:{MONTHS})\s+", "", name.strip())
    return next((c for p, c in CANON if re.search(p, name)), re.sub(r"\s+Committee$", "", name))
ITEM = re.compile(r"^(\d{1,2})\.\s+(.*)")
STATUS = re.compile(r"^\s+(administratively approved|approved by committee|withdrawn|laid over|no votes? necessary|VOTE:\s*(.*))", re.I)
TALLY = re.compile(r"^\s*(\d+) YES\s+(\d+) NO\s+(\d+) ABS\s+(\d+) PNV\s+MOTION (PASSED|FAILED)\s*(?:\((.*)\))?", re.I)
PAGE_NUM = re.compile(r"^\s*\d{1,3}\s*$")
SKIP = re.compile(r"approval of (the )?previous month|vote (to )?adjourn|committee goals|^(cab|cec)\b|reports?$", re.I)


def fetch(months: int) -> dict[str, str]:
    """The newest `months` minutes PDFs as text files; returns PDF name -> URL."""
    MINUTES.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60, follow_redirects=True, headers={"user-agent": "Mozilla/5.0 (tellus minutes indexer)"}) as c:
        links = sorted(set(PDF.findall(c.get(PAGE).text)), key=lambda m: (m[1], m[2]), reverse=True)[:months]
        sources = {}
        for path, _, _ in links:
            name = path.rsplit("/", 1)[1]
            pdf = MINUTES / name
            if not pdf.exists():
                pdf.write_bytes(c.get(SITE + path).raise_for_status().content)
            txt = pdf.with_suffix(".txt")
            if not txt.exists():
                subprocess.run(["pdftotext", "-layout", str(pdf), str(txt)], check=True)
            sources[name] = SITE + path
    (MINUTES / "sources.json").write_text(json.dumps(sources, indent=2) + "\n")
    return sources


def meeting_date(text: str) -> str:
    m = re.search(rf"held on \w+day,\s*((?:{MONTHS}) \d+, \d{{4}})", text)
    return m.group(1) if m else ""


def outcome(status: str, body: str) -> str:
    if not status.upper().startswith("VOTE"):
        return "approve/support" if "approved" in status.lower() else "other"
    b = body.upper()
    if "DENY UNLESS" in b or ("DENIAL" in b and "UNLESS" in b):
        return "deny-unless (stipulations)"
    if "DENIAL" in b or "DENY" in b or "OPPOS" in b:
        return "deny"
    if "APPROV" in b or "SUPPORT" in b:
        return "approve/support"
    return "other"


def vote_text(t: re.Match) -> str:
    yes, no, abs_, pnv, result = t.group(1, 2, 3, 4, 5)
    return f"{result.title()}, {yes} in favor, {no} opposed, {abs_} abstaining, {pnv} present not voting."


def resolutions(text: str, date: str, pdf: str) -> list[dict]:
    lines = [l for l in text.replace("\f", "\n").splitlines() if not PAGE_NUM.match(l)]
    start = next((i for i, l in enumerate(lines) if l.strip().lower().startswith("committee reports")), None)
    if start is None:
        return []
    out: list[dict] = []
    committee, items, cur = None, [], None  # items of the current committee, waiting for its tally

    def close_item():
        nonlocal cur
        if cur and cur["status"] and not SKIP.search(cur["item"]) and not re.match(r"no votes? necessary", cur["status"], re.I):
            items.append(cur)
        cur = None

    def close_committee(tally_lines: list[re.Match]):
        # "(Human Services item 4)" is a separate tally for that item; the plain one covers the rest.
        plain = next((t for t in tally_lines if not t.group(6) or "excluding" in t.group(6).lower()), None)
        for it in items:
            own = next((t for t in tally_lines if t.group(6) and "excluding" not in t.group(6).lower()
                        and re.search(rf"\bitem {it['n']}\b", t.group(6))), None)
            body = "\n".join(it["body"]).strip()
            title = it["item"]
            vt = re.match(r"TITLE:\s*(.*)", it["vote_title"] or "")
            # A resolution's own title says what it is unless it's the generic SLA one; the agenda line names the place.
            if vt and not re.match(r"Community Board 3 Recommendation", vt.group(1), re.I):
                title = re.sub(r"\s+", " ", vt.group(1)).strip()
            t = own or plain
            out.append({
                "id": f"{meeting_month(date)}-{len(out) + 1:03d}", "meeting_date": date, "committee": committee,
                "title": title[:300], "outcome": outcome(it["status"], f"{title}\n{body}"),
                "vote": vote_text(t) if t else it["status"],
                "text": f"{it['item']}\n\n" + re.sub(r"[ \t]+", " ", body) if body else it["item"],
                "source_pdf": pdf,
            })
        items.clear()

    tallies: list[re.Match] = []
    for line in lines[start + 1:]:
        if line.strip().lower().startswith(("old business", "new business", "meeting adjourned", "adjournment")):
            break
        if (t := TALLY.match(line)):
            close_item()
            tallies.append(t)
            continue
        if (c := COMMITTEE.match(line)):
            close_item()
            if committee:
                close_committee(tallies)
            committee, tallies = canon(c.group("name")), []
            continue
        if not committee:
            continue
        if (m := ITEM.match(line)):
            close_item()
            cur = {"n": m.group(1), "item": m.group(2).strip(), "status": None, "vote_title": None, "body": []}
            continue
        if not cur:
            continue
        if cur["status"] is None:
            if (s := STATUS.match(line)):
                cur["status"] = s.group(1).strip()
                cur["vote_title"] = s.group(2)
            elif line.strip():
                cur["item"] += " " + line.strip()  # the agenda line wraps
            continue
        if cur["vote_title"] is not None and not cur["body"] and line.strip() and not line.strip().upper().startswith("WHEREAS"):
            cur["vote_title"] += " " + line.strip()  # the resolution title wraps
            continue
        cur["body"].append(line.rstrip())
    close_item()
    if committee:
        close_committee(tallies)
    return out


def public_session(text: str, date: str, source: str) -> list[dict]:
    m = re.search(r"^\s*Public Session:?\s*$(.*?)^\s*(Public Officials|Elected Officials)", text, re.S | re.M | re.I)
    if not m:
        return []
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", m.group(1).replace("\f", "\n"))]
    items = []
    for p in paras:
        if not p or PAGE_NUM.match(p):
            continue
        p = re.sub(r"^[-–•]\s+", "", p)
        # "Name: remark", "Name (Group) – remark", or "Name spoke on …"
        m = re.match(r"^([^:–]{2,80}?)\s*(?::|\s[–-]\s)\s*(.*)$", p)
        speaker, said = (m.group(1), m.group(2)) if m else ("", p)
        items.append({"topic": "", "speaker_line": speaker.strip(), "text": said.strip()})
    for n, it in enumerate(items, 1):
        it.update(id=f"{meeting_month(date)}-ps{n:02d}", meeting_date=date, source=source)
    return items


def meeting_month(date: str) -> str:
    month, _, year = date.partition(" ")
    return f"{year[-4:]}-{MONTHS.split('|').index(month) + 1:02d}"


def main() -> None:
    sources = fetch(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
    res, ps = [], []
    for name in sorted(sources):
        text = (MINUTES / name).with_suffix(".txt").read_text()
        date = meeting_date(text)
        if not date:
            print(f"  no meeting date in {name}, skipped")
            continue
        res += resolutions(text, date, name)
        ps += public_session(text, date, sources[name])
    (OUT / "resolutions.json").write_text(json.dumps(res, indent=2, ensure_ascii=False) + "\n")
    (OUT / "public_session.json").write_text(json.dumps(ps, indent=1, ensure_ascii=False) + "\n")
    by: dict[str, int] = {}
    for r in res:
        by[r["committee"]] = by.get(r["committee"], 0) + 1
    print(f"{len(res)} resolutions and {len(ps)} public-session remarks from {len(sources)} meetings -> data/cb3/")
    for k, v in sorted(by.items(), key=lambda kv: -kv[1]):
        print(f"  {v:4d}  {k}")


if __name__ == "__main__":
    main()
