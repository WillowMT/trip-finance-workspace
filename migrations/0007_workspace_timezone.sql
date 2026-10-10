-- The workspace's own calendar zone. The ledger and split date fields are read-only and
-- always show today's date in this zone; the CSV instructions use it too.
ALTER TABLE workspace_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok';
