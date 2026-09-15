PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  assigned_admin_id INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_message_at TEXT,
  FOREIGN KEY (assigned_admin_id) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin','admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  is_away INTEGER NOT NULL DEFAULT 0,
  added_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('user_to_admin','admin_to_user')),
  user_id INTEGER NOT NULL,
  admin_id INTEGER,
  source_chat_id INTEGER,
  source_message_id INTEGER,
  relayed_message_id INTEGER,
  content_type TEXT NOT NULL,
  text_content TEXT,
  file_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS canned_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shortcut TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_invites (
  token TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL,
  used_by INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE CASCADE,
  FOREIGN KEY (used_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by INTEGER NOT NULL,
  segment TEXT NOT NULL,
  message_text TEXT,
  file_id TEXT,
  content_type TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_last_message ON users(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_assigned_status ON users(assigned_admin_id, status);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_relayed ON messages(relayed_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source_chat_id, source_message_id);
CREATE INDEX IF NOT EXISTS idx_admins_active ON admins(is_active, role);
CREATE INDEX IF NOT EXISTS idx_invites_expires ON admin_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_processed_updates ON processed_updates(processed_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_created ON broadcast_jobs(created_at DESC);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('away_mode', '0'),
  ('auto_ack', '1'),
  ('welcome_message', 'سلام 👋 به پشتیبانی خوش اومدید! پیام، عکس، ویدیو یا صدای خودتون رو همینجا بفرستید، یکی از همکاران ما در اسرع وقت پاسخ می‌ده.'),
  ('ack_message', 'پیام شما دریافت شد ✅ به‌زودی پاسخ داده می‌شود.'),
  ('away_message', 'در حال حاضر تیم پشتیبانی آفلاین است؛ پیام شما ثبت شد و در اولین فرصت پاسخ داده خواهد شد.'),
  ('blocked_message', 'متأسفانه دسترسی شما به این ربات مسدود شده است.'),
  ('business_hours_enabled', '0'),
  ('business_hours_start', '09:00'),
  ('business_hours_end', '17:00'),
  ('timezone', 'Asia/Tehran');
