-- Partial index on unsent exception rows (node-api database).
--
-- Both email jobs read only rows that have not been sent yet: the hourly
-- per-exception email (unsent rows other than CE failures) and the daily CE
-- digest (unsent CE failures). Rows are never deleted, so without this index
-- both are sequential scans whose cost grows with the whole table. The index
-- holds only the unsent rows, so it stays small. Measured locally on 500k rows
-- with 1k unsent: hourly query 178ms -> 3.7ms, digest query 279ms -> 5.5ms.
--
-- The predicate must stay "sent IS FALSE", matching getExceptions and
-- sendCeDigest in server/queries.js, or the planner cannot use the index.
--
-- CONCURRENTLY so device reports keep inserting while it builds. It cannot run
-- inside a transaction block: apply it as the table owner with psql without -1,
-- not through a wrapping BEGIN/COMMIT. An interrupted concurrent build leaves an
-- INVALID index; drop it and run this again.

CREATE INDEX CONCURRENTLY IF NOT EXISTS neotree_exception_unsent
  ON public.neotree_exception (id)
  WHERE sent IS FALSE;
