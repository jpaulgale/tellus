#!/usr/bin/env bash
# Usage and routing performance from the D1 `events` table (migrations/0004_events.sql), via the cf CLI.
#   scripts/stats.sh [daily|latency|forms|kept|funnel|pages|errors|sql "<query>"] [days, default 7]
# Raw Workers Logs for the same events: cf observability telemetry query (filter on event = "route").
set -euo pipefail
DB=29534f2c-a6f3-4213-974c-a08c44e3b12d
what=${1:-daily}
days=${2:-7}
since="at >= datetime('now', '-$days days')"
# Nearest-rank percentile of a route measure over the window: pct <expr> <fraction>
pct() { echo "(SELECT $1 FROM events WHERE kind = 'route' AND $since ORDER BY $1 LIMIT 1 OFFSET (SELECT CAST(count(*) * $2 AS INT) FROM events WHERE kind = 'route' AND $since))"; }

case $what in
  daily) sql="SELECT date(at) AS day, sum(kind = 'view') AS views, count(DISTINCT session) AS sessions,
      sum(kind = 'route') AS routes, sum(kind = 'record') AS records, sum(kind = 'voice') AS voice, sum(kind = 'send') AS sends,
      sum(kind = 'error') AS errors, CAST(avg(CASE WHEN kind = 'route' THEN ms END) AS INT) AS route_avg_ms
    FROM events WHERE $since GROUP BY day ORDER BY day DESC" ;;
  latency) j="json_extract(data, '$.jevMs')"; l="json_extract(data, '$.lookupMs')"
    sql="SELECT count(*) AS routes,
      $(pct ms 0.5) AS total_p50, $(pct ms 0.95) AS total_p95,
      $(pct "$l" 0.5) AS lookup_p50, $(pct "$l" 0.95) AS lookup_p95,
      $(pct "$j" 0.5) AS jev_p50, $(pct "$j" 0.95) AS jev_p95,
      CAST(avg(json_extract(data, '$.usage.input_tokens')) AS INT) AS avg_in_tokens,
      CAST(avg(json_extract(data, '$.usage.output_tokens')) AS INT) AS avg_out_tokens
    FROM events WHERE kind = 'route' AND $since" ;;
  forms) sql="SELECT form, count(*) AS routes, round(avg(json_extract(data, '$.p')), 2) AS avg_p,
      round(avg(json_extract(data, '$.margin')), 2) AS avg_margin, sum(json_extract(data, '$.margin') < 0.2) AS close_calls,
      sum(json_extract(data, '$.emergency') > 0.5) AS emergency,
      round(avg(json_extract(data, '$.locations')), 1) AS avg_locations, sum(json_extract(data, '$.pastAtAddress') > 0) AS with_past
    FROM events WHERE kind = 'route' AND $since GROUP BY form ORDER BY routes DESC" ;;
  kept) sql="SELECT r.form AS routed, s.form AS sent, count(*) AS sends,
      round(avg(json_array_length(json_extract(s.data, '$.edited'))), 1) AS avg_fields_edited,
      sum(json_extract(s.data, '$.voice')) AS voice
    FROM events s JOIN events r ON r.route_id = s.route_id AND r.kind = 'route'
    WHERE s.kind = 'send' AND s.$since GROUP BY routed, sent ORDER BY sends DESC" ;;
  funnel) sql="SELECT count(*) AS sessions, sum(routed) AS routed, sum(record) AS picked_place, sum(voice) AS used_voice, sum(sent) AS sent
    FROM (SELECT session, max(kind = 'route') AS routed, max(kind = 'record') AS record, max(kind = 'voice') AS voice, max(kind = 'send') AS sent
      FROM events WHERE session IS NOT NULL AND $since GROUP BY session)" ;;
  pages) sql="SELECT json_extract(data, '$.path') AS path, coalesce(json_extract(data, '$.ref'), '(direct)') AS ref,
      json_extract(data, '$.country') AS country, count(*) AS views, count(DISTINCT session) AS sessions,
      sum(json_extract(data, '$.width') < 700) AS phone
    FROM events WHERE kind = 'view' AND $since GROUP BY 1, 2, 3 ORDER BY views DESC LIMIT 40" ;;
  errors) sql="SELECT at, json_extract(data, '$.path') AS path, substr(json_extract(data, '$.error'), 1, 120) AS error
    FROM events WHERE kind = 'error' AND $since ORDER BY at DESC LIMIT 30" ;;
  sql) sql=$2 ;;
  *) sed -n 2,4p "$0"; exit 1 ;;
esac

cf d1 query "$DB" --sql "$sql" | jq -r '.[0].results | (.[0] // {} | keys_unsorted) as $k | ($k | @tsv), (.[] | [.[$k[]]] | map(. // "") | @tsv)' | column -t -s $'\t'
