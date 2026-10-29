-- Which community board passed each resolution (worker/boards.json key). CB2's rows keep their ids;
-- other boards' ids are prefixed with the board ("cb3-2026-06-001") because every board numbers by month.
ALTER TABLE resolutions ADD COLUMN board TEXT NOT NULL DEFAULT 'cb2';
CREATE INDEX IF NOT EXISTS resolutions_board ON resolutions (board, bbl);
