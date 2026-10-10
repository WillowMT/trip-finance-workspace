-- A capability link can be superseded without stranding whoever still holds
-- the previous one: keep the retired hash alongside the current one and let
-- resolveWorkspace match either (see src/worker.ts).
ALTER TABLE workspaces ADD COLUMN prev_secret_hash TEXT;
