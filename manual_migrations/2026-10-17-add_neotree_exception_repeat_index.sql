-- Hash index on reporting tablet + message of exception rows (node-api database).
--
-- The hourly exception email sends each error once per tablet and app version:
-- before sending, it marks as sent every unsent row whose tablet, message and
-- version already have a sent row (MARK_REPEATS_SENT in server/queries.js).
-- Rows are never deleted, so without this index that lookup reads the whole
-- table every hour. With it, it reads only that tablet's rows for that error.
-- Measured locally with 1k new rows: 500k rows 432ms -> 62ms, 2M rows 2.1s ->
-- 0.36s. An index on device_id alone made it slower (few tablets, many rows
-- each).
--
-- Hash, not btree: a btree entry is limited to about 2.7 kB and messages can be
-- longer, which would make inserts fail. The expression must stay
-- (device_id || message), matching MARK_REPEATS_SENT, or the planner cannot use
-- it. The email works without the index, only slower.
--
-- CONCURRENTLY so device reports keep inserting while it builds. It cannot run
-- inside a transaction block: apply it as the table owner with psql without -1,
-- not through a wrapping BEGIN/COMMIT. An interrupted concurrent build leaves an
-- INVALID index; drop it and run this again.

CREATE INDEX CONCURRENTLY IF NOT EXISTS neotree_exception_repeat
  ON public.neotree_exception USING hash ((device_id || message));
