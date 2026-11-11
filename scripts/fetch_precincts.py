# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Every NYPD precinct's name, station address, main phone and page, from nyc.gov.

Writes worker/precincts.json keyed by precinct number ("6"). The worker uses it to hand a resident
the phone number of the precinct that covers their address (PLUTO's policeprct column).
"""

import html
import json
import re
import time
import urllib.request
from pathlib import Path

BASE = "https://www.nyc.gov"
LANDING = f"{BASE}/site/nypd/bureaus/patrol/precincts-landing.page"
OUT = Path(__file__).resolve().parent.parent / "worker" / "precincts.json"
PHONE = r"\(\d{3}\)\s*\d{3}-\s*\d{4}"  # the 68th writes "(718) 439- 4211"
# Three precincts go by name; PLUTO and 311 number them.
NAMED = {"Midtown South": "14", "Midtown North": "18", "Central Park": "22"}


def get(url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (tellus precinct list)"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def text_of(page: str) -> str:
    page = re.sub(
        r"<script.*?</script>|<style.*?</style>|<!--.*?-->", "", page, flags=re.S
    )
    t = html.unescape(re.sub(r"<[^>]+>", "\n", page))
    return "\n".join(line.strip() for line in t.splitlines() if line.strip())


def parse(path: str, page: str) -> dict | None:
    t = text_of(page)
    name = re.search(rf"^(\d+(?:st|nd|rd|th)|{'|'.join(NAMED)}) Precinct$", t, re.M)
    phone = re.search(rf"^Precinct:\n?\s*({PHONE})", t, re.M)
    if not name or not phone:
        return None
    contact = [
        x for x in t.split("Contact Information", 1)[-1].splitlines() if x.strip()
    ]
    address = ", ".join(contact[:2]) if len(contact) > 1 else None
    return {
        "number": NAMED.get(name.group(1)) or re.sub(r"\D", "", name.group(1)),
        "name": name.group(0),
        "phone": re.sub(r"-\s+", "-", re.sub(r"\)\s*", ") ", phone.group(1))),
        "address": address,
        "url": BASE + path,
    }


def main() -> None:
    paths = sorted(
        set(
            re.findall(
                r'href="(/site/nypd/bureaus/patrol/precincts/[^"]+\.page)"',
                get(LANDING),
            )
        )
    )
    out: dict[str, dict] = {}
    for path in paths:
        p = parse(path, get(BASE + path))
        if p:
            out[p.pop("number")] = p
        else:
            print("skipped", path)
        time.sleep(0.3)
    out = dict(sorted(out.items(), key=lambda kv: int(kv[0])))
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(out)} precincts -> {OUT}")


if __name__ == "__main__":
    main()
