CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  destination TEXT NOT NULL,   -- 311, CB2, DOT, NYPD, DSNY, DOHMH
  form TEXT,                   -- street_light, traffic_signal, cb2, ...
  complaint_type TEXT,
  committee TEXT,              -- CB2 committee, when routed to the board
  address TEXT,
  bbl TEXT,
  lat REAL,
  lng REAL,
  message TEXT,                -- what the resident said or typed
  payload TEXT NOT NULL        -- the full JSON payload as sent
);
CREATE INDEX IF NOT EXISTS submissions_committee ON submissions (committee, created_at);
