-- Telegram navigation menu links.
--
-- A chat that is already connected to a trip gets a button grid in /start that opens the trip in a
-- browser. The workspace capability secret is stored only as a SHA-256 hash, so a link can never be
-- rebuilt from the database. Each button therefore carries a token of its own: it is stored here as a
-- hash only (exactly like a pairing token), it is bound to the one chat connection it was minted for,
-- it expires, and it dies with the connection.

CREATE TABLE telegram_nav_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES telegram_connections(id),
  token_hash    TEXT NOT NULL UNIQUE,
  uses          INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX telegram_nav_links_connection_idx ON telegram_nav_links (connection_id);
CREATE INDEX telegram_nav_links_expiry_idx ON telegram_nav_links (expires_at);
