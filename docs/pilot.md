# Demo script, portability, and what only outside people can confirm

## 7-minute demo (CB2 Manhattan)

1. **The problem (30 s).** CB2 got 47,430 requests to 311 in the past year, and the board's own intake is email and Public Session. Open `/dashboard/insights.html`: every number there is recomputed from Open Data and the minutes by `scripts/build_trends.py`.
2. **Where 311 and the board meet (90 s).** The top card: 116 "Noise - Commercial" reports at 67 E 11th St in 90 days, mostly 7–9 am and 6 pm. On July 24, 2025 SLA 1 approved a board-game café on that lot with 13 stipulations, including "no music audible in adjacent residences." Say plainly that a shared lot is not proof it's the same business; that's the question the district manager would ask, and the tool puts it in front of them.
3. **A resident writes (2 min).** On `/`, type: *"The bar at 1 West 3rd Street plays loud music until 2am every weekend."* It fills the board's form, names Ronnie Scott's from the board's own record, shows the stipulation the complaint matches, and under it "Already reported to 311": 113 requests on that lot, with how each was closed and a link to the same query on Open Data. Then type the same thing in Spanish: *"El bar en el 7 de Cornelia pone la música altísima todas las noches."* Point out the note above Submit: nothing is filed.
4. **What the board sees (90 s).** `/dashboard/`, open "Business using outdoor space it agreed not to use": Brian Pape's words at the May 21, 2026 Full Board, verbatim from the minutes, with stipulation 4 of 15 highlighted ("Will not operate … any sidewalk café and/or roadbed seating") and "Refer to State Liquor Authority" suggested.
5. **How often it's wrong (60 s).** `/how#accuracy`: 95% right 311 form, 80% didn't force a wrong form on requests we have no form for, 82% right committee on residents' Public Session remarks. Against the minutes themselves (`scripts/eval_resolutions.py`, 212 resolutions rewritten as residents' requests, with the record cut off before each meeting) the committee is right 87% of the time for CB2 and 99% for CB3, weighted by how often each committee comes up; always guessing the biggest committee gets 33% and 89%. Read one miss aloud: bar-noise complaints go to the board instead of 311 noise, because the board has stipulations there. Whether that's wrong is a policy question for the board.
6. **Your board (60 s).** Click CB3 in the board switch. Type *"The bar at 117 Avenue A keeps its front doors open after 10pm and the music fills my apartment."* It goes to CB3's SLA Licensing & Outdoor Dining committee and highlights the stipulation CB3 set on June 23, 2026: close the front doors at 10 pm. Then open CB3's Trends: Traffic is "up 617%", but 1,810 of the 1,814 reports are truck-route complaints at 20 Clinton Street. The page says so; that's what a district manager would check first.

## Portability: Manhattan CB3

`scripts/parse_minutes_cb3.py` downloads CB3's minutes from nyc.gov and writes `data/cb3/resolutions.json` and `data/cb3/public_session.json` in CB2's schemas; `scripts/build_resolution_index.py cb3` geocodes them. On the last 20 meetings:

- **816 resolutions**: 721 SLA and outdoor dining, 40 transportation, the rest across 8 other committees. In June 2026 it matched the minutes item for item (14 `VOTE:` resolutions plus the administratively approved and withdrawn items).
- **723 on the map (89%)**, and every placed lot is in Community District 3 according to PLUTO. CB2 manages 76%.
- **159 of 160** "deny unless stipulations" resolutions have their stipulations split out (median 13), so the form can highlight the one a complaint is about, as it does for CB2.
- **54 Public Session remarks.** CB3's Public Session is short; several months had one speaker.

Why it needed its own parser: CB3's minutes are on nyc.gov, not the cbmanhattan site; each committee report is a numbered agenda with a status line under each item, and the Full Board tally comes once per committee. `build_resolution_index.py` gained CB3's address forms ("117 Ave A", "221 E B'way", "St Marks Pl") and its `1)` stipulations; CB2's output is byte-identical.

CB3 is now a mode: `?board=cb3` on `/`, `/dashboard/` and `/dashboard/insights.html`. The board's district, committees, areas, map center and examples come from `worker/boards.json`; the worker reads the board from `?board=` or the `x-board` header. Not done for CB3: committee labels on its Public Session remarks (Trends says "Not yet labeled"), its own routing eval, and its board-view requests are picked by hand from its minutes.

## Clairic (Workers AI) in form filling

`/api/route` asks Clairic (`@cf/cloudflare/clairic`, `worker/clairic.ts`) for the house number, street, cross street, named place, business and time in the message, before the open-data lookups. Like the regex finders, its answers are spans of the message that only add candidates: GeoSearch checks the place and Jev still picks every field. If Clairic fails or takes over 2 s, routing runs as before.

On the same 104 real 311 cases:

| | Regex only | With Clairic |
|---|---|---|
| Place filled in (of 79 with a tax lot) | 28 | 61 |
| …on the lot 311 recorded | 28 | 61 |
| Right 311 form / didn't force a wrong one | 94% / 70% | 94% / 75% |
| Right committee (103 Public Session) | 83 | 82 |
| Median latency | 1.16 s | 1.31 s |

What it fixes is addresses without a street suffix and in other languages: "126 W 13th", "15 Mercer", "el 101 de Crosby", "Mott街228号", "百老汇508号". All 7 Chinese and 6 of the Spanish cases that name an address now fill it in. One Clairic error turned up and is handled in code: it read "325 W 11th" as street "11th", which GeoSearch took for 11th Avenue, so a direction right before the span is put back.

Needs: the Worker's `AI` binding (in `wrangler.jsonc`). The orb's REST token can't call Workers AI, but the binding works through `wrangler dev`.

## What only outside people can confirm

| Check | Who | Protocol |
|---|---|---|
| Committee routing | CB2 district manager or staff | Give them the 103 Public Session concerns (`data/public_session.json`) without our labels; they assign committees blind. Compare with `data/eval/results.json`. Our two raters agreed on every committee (κ = 1.0) but got SLA 1/2 backwards; staff are the real key. |
| "Already reported" counts | Anyone | Every 311 card links its Open Data query; spot-check 5 addresses on the 311 Service Request Map. |
| Whether flagged issues matter | The board | Before the next Full Board, list the top 3 Trends hotspots; afterward, check the agenda and minutes for them. |
| Residents finishing unaided | 5 residents: 1 Spanish, 1 Chinese speaker, 1 over 70, 1 screen-reader user | Same complaint, timed, on Tell Us and on portal.311.nyc.gov. Note where they hesitate. |
| Language access | A native Spanish and Chinese speaker | Routing works (9/10 and 7/8), but the whole UI is English. Have them use it and list what they couldn't read. |
