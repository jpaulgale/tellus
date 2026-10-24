# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Download every Full Board minutes PDF listed on CB2's minutes page into data/minutes/, convert
each to text with `pdftotext -layout`, and record where each PDF came from in data/minutes/sources.json.

Usage: uv run scripts/fetch_minutes.py
"""

import json
import re
import subprocess
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
MINUTES = ROOT / "data" / "minutes"
PAGE = "https://cbmanhattan.cityofnewyork.us/cb2/minutes/"
PDF = re.compile(
    r'href="(https://[^"]+/[^"/]*Full-Board-Minutes[^"/]*\.pdf)"', re.IGNORECASE
)


def main() -> None:
    with httpx.Client(
        timeout=60,
        follow_redirects=True,
        headers={"user-agent": "Mozilla/5.0 (cbform minutes indexer)"},
    ) as client:
        urls = sorted(set(PDF.findall(client.get(PAGE).text)))
        sources = {}
        for url in urls:
            name = url.rsplit("/", 1)[1]
            pdf = MINUTES / name
            if not pdf.exists():
                pdf.write_bytes(client.get(url).raise_for_status().content)
            txt = pdf.with_suffix(".txt")
            if not txt.exists():
                subprocess.run(["pdftotext", "-layout", str(pdf), str(txt)], check=True)
            sources[name] = url
    (MINUTES / "sources.json").write_text(json.dumps(sources, indent=2))
    print(f"{len(sources)} minutes PDFs in {MINUTES.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
