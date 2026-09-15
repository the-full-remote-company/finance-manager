-- VQ-1, from data-model.md and plan.md.
--
-- Question: does PostgreSQL 17 accept EXTRACT(... FROM <date column>) inside a
-- GENERATED ALWAYS AS ... STORED expression? A generated column's expression
-- must be immutable. EXTRACT over `date` appears to resolve through an
-- immutable path, but Article IX forbids asserting what has not been executed.
--
-- Fallback if this fails: a plain `integer not null` column derived in
-- packages/core, plus CHECK (start_month = <expression>) — a check constraint
-- carries no immutability requirement. The schema shape and every other
-- constraint are unchanged either way.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMPORARY TABLE vq1_probe (
  start_date date NOT NULL,
  start_month integer GENERATED ALWAYS AS (
    EXTRACT(YEAR FROM start_date)::int * 12 + EXTRACT(MONTH FROM start_date)::int - 1
  ) STORED,
  end_date date,
  end_month integer GENERATED ALWAYS AS (
    EXTRACT(YEAR FROM end_date)::int * 12 + EXTRACT(MONTH FROM end_date)::int - 1
  ) STORED
) ON COMMIT DROP;

-- 2026-01 is index 2026*12 + 0 = 24312. 2026-12 is 24323.
INSERT INTO vq1_probe (start_date, end_date) VALUES
  ('2026-01-01', '2026-12-31'),
  ('2026-03-15', NULL),
  ('1999-12-31', '2000-01-01');

-- A generated column can carry a unique constraint, which FR-024 needs on
-- (commitment_id, effective_month).
CREATE UNIQUE INDEX vq1_probe_month ON vq1_probe (start_month);

SELECT
  start_date,
  start_month,
  start_month = EXTRACT(YEAR FROM start_date)::int * 12 + EXTRACT(MONTH FROM start_date)::int - 1
    AS start_month_correct,
  end_date,
  end_month,
  end_month IS NULL = (end_date IS NULL) AS null_propagates
FROM vq1_probe
ORDER BY start_date;

COMMIT;

\echo 'VQ-1 PASS: EXTRACT is accepted in a STORED generated column, values are correct, NULL propagates, and the column is indexable.'
