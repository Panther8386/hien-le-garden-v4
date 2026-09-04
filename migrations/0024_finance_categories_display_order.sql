-- v4/migrations/0024_finance_categories_display_order.sql

ALTER TABLE finance_categories ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

-- Backfill distinct display_order values per type (income/expense), ordered by id,
-- so the reorder endpoint's value-swap isn't a no-op on rows that all default to 0.
UPDATE finance_categories SET display_order = (
  SELECT COUNT(*) FROM finance_categories b
  WHERE b.type = finance_categories.type AND b.id < finance_categories.id
);
