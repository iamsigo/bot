ALTER TABLE broadcast_jobs ADD COLUMN source_chat_id INTEGER;
ALTER TABLE broadcast_jobs ADD COLUMN source_message_id INTEGER;
ALTER TABLE broadcast_jobs ADD COLUMN cursor INTEGER NOT NULL DEFAULT 0;
