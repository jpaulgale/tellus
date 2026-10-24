-- Past CB2 Full Board resolutions (scripts/build_resolution_index.py writes the rows to data/resolutions.sql).
CREATE TABLE IF NOT EXISTS resolutions (
  id TEXT PRIMARY KEY,         -- 2025-06-013: meeting month and order in the minutes
  meeting_date TEXT NOT NULL,  -- as printed: June 18, 2025
  meeting_iso TEXT NOT NULL,   -- 2025-06-18, for sorting
  committee TEXT NOT NULL,
  title TEXT NOT NULL,
  address TEXT,                -- null when the resolution names no street address
  legal_name TEXT,
  dba TEXT,
  license_type TEXT,
  outcome TEXT,
  vote TEXT,
  bbl TEXT,
  lat REAL,
  lng REAL,
  stipulations TEXT NOT NULL DEFAULT '[]',  -- JSON array
  source TEXT NOT NULL         -- the minutes PDF
);
CREATE INDEX IF NOT EXISTS resolutions_bbl ON resolutions (bbl);
CREATE INDEX IF NOT EXISTS resolutions_lat ON resolutions (lat, lng);
-- Full text for BM25 search: a resident's words against what the board discussed.
CREATE VIRTUAL TABLE IF NOT EXISTS resolutions_fts USING fts5(
  id UNINDEXED, title, dba, address, committee, body, tokenize = 'porter unicode61'
);
