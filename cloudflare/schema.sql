CREATE TABLE IF NOT EXISTS watch_rooms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host_participant_id TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_watch_rooms_created_at ON watch_rooms(created_at);

CREATE TABLE IF NOT EXISTS room_members (
  room_code TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('host', 'moderator', 'member')),
  permissions TEXT NOT NULL DEFAULT '[]',
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_code, participant_id),
  FOREIGN KEY (room_code) REFERENCES watch_rooms(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_code, role);

CREATE TABLE IF NOT EXISTS room_settings (
  room_code TEXT PRIMARY KEY,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_code) REFERENCES watch_rooms(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_member_moderation (
  room_code TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  camera_blocked INTEGER NOT NULL DEFAULT 0,
  kicked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_code, participant_id),
  FOREIGN KEY (room_code, participant_id) REFERENCES room_members(room_code, participant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_member_moderation_room ON room_member_moderation(room_code, kicked_at);

CREATE TABLE IF NOT EXISTS room_messages (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  author_participant_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deleted_by_participant_id TEXT,
  FOREIGN KEY (room_code) REFERENCES watch_rooms(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_messages_room_created ON room_messages(room_code, created_at);
