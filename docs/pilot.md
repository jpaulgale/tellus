# Demo script, portability, and what only outside people can confirm

## 7-minute demo (CB2 Manhattan)

1. **The problem (30 s).** CB2 got 47,430 requests to 311 in the past year, and the board's own intake is email and Public Session. Open `/dashboard/insights.html`: every number there is recomputed from Open Data and the minutes by `scripts/build_trends.py`.
2. **Where 311 and the board meet (90 s).** The top card: 116 "Noise - Commercial" reports at 67 E 11th St in 90 days, mostly 7–9 am and 6 pm. On July 24, 2025 SLA 1 approved a board-game café on that lot with 13 stipulations, including "no music audible in adjacent residences." Say plainly that a shared lot is not proof it's the same business; that's the question the district manager would ask, and the tool puts it in front of them.
3. **A resident writes (2 min).** On `/`, type: *"The bar at 1 West 3rd Street plays loud music until 2am every weekend."* It fills the board's form, names Ronnie Scott's from the board's own record, shows the stipulation the complaint matches, and under it "Already reported to 311": 113 requests on that lot, with how each was closed and a link to the same query on Open Data. Then type the same thing in Spanish: *"El bar en el 7 de Cornelia pone la música altísima todas las noches."* Point out the note above Submit: nothing is filed.
4. **What the board sees (90 s).** `/dashboard/`, open "Business using outdoor space it agreed not to use": Brian Pape's words at the May 21, 2026 Full Board, verbatim from the minutes, with stipulation 4 of 15 highlighted ("Will not operate … any sidewalk café and/or roadbed seating") and "Refer to State Liquor Authority" suggested.
5. **How often it's wrong (60 s).** `/how#accuracy`: 94% right 311 form, 70% didn't force a wrong form on requests we have no form for, 81% right committee against the minutes. Read one miss aloud: bar-noise complaints go to the board instead of 311 noise, because the board has stipulations there. Whether that's wrong is a policy question for the board.
6. **Your board (60 s).** Don't port live yet (see below). Show the CB3 minutes and say what a port takes.

## Portability: Manhattan CB3 (tried, not done)

Timed from a cold start. Within 5 minutes it was clear the README's claim, that another board needs only its committee list and minutes, is not true:

- **Minutes are elsewhere.** CB3's are on nyc.gov (`/site/manhattancb3/minutes/meeting-vote-records.page`, 275 PDFs), not the `cbmanhattan.cityofnewyork.us` WordPress site `fetch_minutes.py` scrapes. Needs a per-board source URL and link pattern.
- **Different format.** `parse_minutes.py` found **0** resolutions in CB3's minutes and vote sheets; `parse_public_session.py` found **0** remarks. CB3 writes "Public Session:" with each speaker inline on one line, and its resolutions are in monthly *vote sheets* ("VOTE: TITLE: Community Board 3 Recommendation To Deny Unless Stipulations Agreed To", committee headings in mixed case). Needs a second parser.
- **CB2 is hard-coded in ~40 places**: `BOARD_CD = "102"`, the GeoSearch focus point, the 311 `community_board` filter, catalog committees and their descriptions, Jev prompts that say "Community Board 2", page copy.

Estimate: a day per board for a parser and config, after moving the CB2 constants into one board config file. The parser is the part worth replacing with a model (see Clairic below).

## Clairic (Workers AI) for extraction

- **Not needed for OCR here.** All 19 CB2 minutes PDFs have a text layer; `pdftotext` gets everything. The 12 near-empty pages are blank or signature pages, and the embedded images are street photos and a few DOT diagrams.
- **Worth trying for structure.** What breaks is splitting minutes into resolutions, addresses, votes and stipulations with regexes: 295 of 1,221 CB2 resolutions have no address the geocoder accepts, and CB3's format yields nothing. Clairic returns typed fields with source spans (address, vote counts, outcome, list of stipulations) per resolution, which is the per-board parser we'd otherwise write by hand, and it reads images for boards that post scans.
- **Not tested.** The orb's `CLOUDFLARE_API_TOKEN` gets "Authentication error" on Workers AI; it needs the Workers AI permission. Next step: run it on the 21 CB3 vote sheets and score against a hand-labeled month.

## What only outside people can confirm

| Check | Who | Protocol |
|---|---|---|
| Committee routing | CB2 district manager or staff | Give them the 103 Public Session concerns (`data/public_session.json`) without our labels; they assign committees blind. Compare with `data/eval/results.json`. Our two raters agreed on every committee (κ = 1.0) but got SLA 1/2 backwards; staff are the real key. |
| "Already reported" counts | Anyone | Every 311 card links its Open Data query; spot-check 5 addresses on the 311 Service Request Map. |
| Whether flagged issues matter | The board | Before the next Full Board, list the top 3 Trends hotspots; afterward, check the agenda and minutes for them. |
| Residents finishing unaided | 5 residents: 1 Spanish, 1 Chinese speaker, 1 over 70, 1 screen-reader user | Same complaint, timed, on Tell Us and on portal.311.nyc.gov. Note where they hesitate. |
| Language access | A native Spanish and Chinese speaker | Routing works (9/10 and 7/8), but the whole UI is English. Have them use it and list what they couldn't read. |
