-- Custom SQL migration file, put your code below! --
CREATE INDEX IF NOT EXISTS items_fts_idx
  ON items USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(text,'')));