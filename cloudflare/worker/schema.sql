-- Nebula CRM — Cloudflare D1 schema
--
-- One document table mirrors the Firestore shape the app already thinks in:
-- every record is {col, id, json}. `col` holds the FULL collection path, so
-- subcollections (chat_threads/{tid}/messages) work with no extra tables.
-- Timestamps and other rich values are stored as typed markers inside the
-- JSON (see src/data.js) and hydrated back into real Dart objects by the
-- app's codec — models keep parsing exactly what Firestore used to hand them.

CREATE TABLE IF NOT EXISTS docs (
  col        TEXT NOT NULL,
  id         TEXT NOT NULL,
  team_id    TEXT,
  json       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (col, id)
);

-- Equality filters the app uses, evaluated over JSON paths.
CREATE INDEX IF NOT EXISTS idx_docs_col_team   ON docs(col, team_id);
CREATE INDEX IF NOT EXISTS idx_docs_col_owner  ON docs(col, json_extract(json, '$.ownerId'));
CREATE INDEX IF NOT EXISTS idx_docs_col_user   ON docs(col, json_extract(json, '$.userId'));
CREATE INDEX IF NOT EXISTS idx_docs_col_source ON docs(col, json_extract(json, '$.source'));

-- Small key/value side table for singletons (bootstrap claim, markers).
CREATE TABLE IF NOT EXISTS meta (
  k   TEXT PRIMARY KEY,
  v   TEXT NOT NULL
);
