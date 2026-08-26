CREATE TABLE IF NOT EXISTS watch_rooms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host_participant_id TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_watch_rooms_created_at ON watch_rooms(created_at);
