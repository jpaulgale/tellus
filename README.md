# Tell Us

Share feedback with your community board and city agencies: **https://tellus.paulgale.dev**

Tell Us helps NYC residents be heard: say what's on your mind about your neighborhood, and it fills in the right 311 or community board form for you to review, along with any past board decisions relevant to your topic.

The demo is set up for Manhattan Community Board 2. The 311 forms work citywide; another board needs only its committee list and its meeting minutes (see [Board minutes](#board-minutes)).

Built at the [State Capacity Hackathon](https://statecapacityecosystem.com/) by [Paul Gale](https://paulgale.dev), [Luke Szumyckyj](https://www.linkedin.com/in/lmszu/) and [Sam Ginsberg](https://www.linkedin.com/in/sam-ginsberg).

A hackathon demo, not an official NYC service and not affiliated with the City of New York.

## Pages

- `/`: the resident form. One text box (or the mic); the form for the matching destination fills in below it.
- `/how`: how it works, with an animated walkthrough.
- `/dashboard`: what a board member would see: incoming feedback grouped by committee, each with the board's past decisions at that address.

## How it works

- **Routing and form filling.** Code finds every candidate value in the message: addresses through NYC GeoSearch, intersections from the NYC street centerline, businesses from NYS liquor licenses. One [TypeSafe](https://typesafe.ai) Jev call then decides whether it's an emergency, which 311 form or board committee it belongs to, and picks a value for every field. The model only chooses among candidates the code found.
- **Voice.** Gemini Live transcribes speech and fills the same fields.
- **Board record.** 1,226 resolutions parsed from CB2's Full Board minutes (Jan 2025 – Jul 2026), geocoded to tax lots and searchable with BM25 in D1. When a resident's address matches, the form shows the board's decision there and the condition their feedback relates to.
- **Submissions** are stored in D1. NYC 311 has no public submission API, so sending is simulated (optionally forwarded to a webhook).

The dashboard's requests are sample data (`public/dashboard/requests.json`), run through the real pipeline by `scripts/build_dashboard_data.py`.

## Stack

Cloudflare Workers + D1 (`worker/`), plain HTML/JS (`public/`), Mapbox for maps, Python scripts for the data pipeline (`scripts/`).

## Run locally

```sh
npm ci
npx wrangler d1 migrations apply cbform --local
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
npx wrangler d1 execute cbform --local --file data/resolutions.sql
```

`.agents/` holds setup scripts for [Amp](https://ampcode.com) cloud workspaces; they aren't needed to run locally.
