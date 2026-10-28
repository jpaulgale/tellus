-- Usage and performance events, one row each, queried with `cf d1 query` (scripts/stats.sh).
-- No resident text here: the words live only in `submissions`, for people who chose to send.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind TEXT NOT NULL,          -- view, route, record, voice, send, error
  session TEXT,                -- random per browser tab (public/js/hit.js)
  route_id TEXT,               -- links a send to the route that filled its form
  form TEXT,                   -- top form for a route; the form sent for a send
  ms INTEGER,                  -- server time for the request
  data TEXT                    -- JSON with the rest (json_extract in queries)
);
CREATE INDEX IF NOT EXISTS events_kind ON events (kind, at);
CREATE INDEX IF NOT EXISTS events_route ON events (route_id);
