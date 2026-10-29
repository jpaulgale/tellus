# Tell Us

Share feedback with your community board and city agencies: **https://tellus.paulgale.dev**

Tell Us helps NYC residents be heard: say what's on your mind about your neighborhood, and it fills in the right 311 or community board form for you to review, along with any past board decisions relevant to your topic.

The demo is set up for Manhattan Community Board 2. The 311 forms work citywide. Another board needs its committee list, its minutes, and a parser for its minutes' format; `scripts/parse_minutes_cb3.py` is the one for CB3 (see [docs/pilot.md](docs/pilot.md)).

Built at the [State Capacity Hackathon](https://statecapacityecosystem.com/) by [Paul Gale](https://paulgale.dev), [Luke Szumyckyj](https://www.linkedin.com/in/lmszu/) and [Sam Ginsberg](https://www.linkedin.com/in/sam-ginsberg).

A hackathon demo, not an official NYC service and not affiliated with the City of New York.

## Pages

- `/`: the resident form. One text box (or the mic); the form for the matching destination fills in below it.
- `/how`: how it works, with an animated walkthrough.
- `/dashboard`: what a board member would see: incoming feedback grouped by committee, each with the board's past decisions at that address.

## How it works

- **Routing and form filling.** Code finds every candidate value in the message: addresses through NYC GeoSearch (with [Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/) on Workers AI reading the house number and street out of messages like "Mott街228号"), intersections from the NYC street centerline, businesses from NYS liquor licenses. One [TypeSafe](https://typesafe.ai) Jev call then decides whether it's an emergency, which 311 form or board committee it belongs to, and picks a value for every field. The model only chooses among candidates the code found.
- **Voice.** Gemini Live transcribes speech and fills the same fields.
- **Board record.** 1,226 resolutions parsed from CB2's Full Board minutes (Jan 2025 – Jul 2026), geocoded to tax lots and searchable with BM25 in D1. When a resident's address matches, the form shows the board's decision there and the condition their feedback relates to.
- **Submissions** are stored in D1. NYC 311 has no public submission API, so sending is simulated (optionally forwarded to a webhook).

The dashboard's requests are real Public Session remarks from the minutes, run through the real pipeline by `scripts/build_dashboard_data.py`. The Trends page and the "Already reported to 311" card come from NYC Open Data's 311 requests (`scripts/fetch_311.py`, `scripts/build_trends.py`, `/api/history`).

## How often it's right

`scripts/eval_routing.py` runs 104 real CB2 311 requests (resident wording written blind, 18 in Spanish or Chinese) and 103 Public Session concerns (two independent raters, committee checked against the minutes) through `/api/route`. Results go to `public/eval.json` and show on `/how`; every case is in `data/eval/results.json`. The demo script and outside checks are in [docs/pilot.md](docs/pilot.md).

## Usage and performance

The worker writes one row per page view, route, place lookup, voice session, send and error to the D1 `events` table (no resident text; that stays in `submissions`). A random per-tab session id links a visit's events, and each send carries the id of the route that filled its form, so you can see whether people kept the form Jev picked.

```sh
scripts/stats.sh daily     # views, sessions, routes, sends, errors per day
scripts/stats.sh latency   # p50/p95 of total, lookup and Jev time; tokens
scripts/stats.sh forms     # top form mix, confidence, close calls
scripts/stats.sh kept      # routed form vs. sent form, fields edited
scripts/stats.sh funnel    # sessions → routed → picked a place → sent
scripts/stats.sh pages 30  # views by page, referrer, country (last 30 days)
scripts/stats.sh errors
```

It uses `cf d1 query` (`cf auth login` first). The same events are in Workers Logs: `cf observability telemetry query`.

## Stack

Cloudflare Workers + D1 (`worker/`), plain HTML/JS (`public/`), Mapbox for maps, Python scripts for the data pipeline (`scripts/`).

## Run locally

```sh
npm ci
npx wrangler d1 migrations apply DB --local
```

Create `.dev.vars` with your keys:

```
TYPESAFE_API_KEY=...
GEMINI_API_KEY=...      # optional: voice input
MAPBOX_TOKEN=pk....     # optional: maps
SEND_WEBHOOK_URL=...    # optional: forward submissions
```

Then `npm run dev` and open http://localhost:8787.

### Board minutes

`data/resolutions.json` is committed. To rebuild it and load it into D1 (needs `pdftotext` from poppler):

```sh
uv run scripts/fetch_minutes.py          # download the minutes PDFs from CB2's site
uv run scripts/parse_minutes.py          # split them into resolutions
uv run scripts/build_resolution_index.py # geocode and write data/resolutions.sql
npx wrangler d1 execute DB --local --file data/resolutions.sql
```

`.agents/` holds setup scripts for [Amp](https://ampcode.com) cloud workspaces; they aren't needed to run locally.
