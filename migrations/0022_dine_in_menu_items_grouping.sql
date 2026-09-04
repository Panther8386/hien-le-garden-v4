-- v4/migrations/0022_dine_in_menu_items_grouping.sql

ALTER TABLE dine_in_menu_items ADD COLUMN subgroup TEXT;
ALTER TABLE dine_in_menu_items ADD COLUMN unit TEXT;
ALTER TABLE dine_in_menu_items ADD COLUMN requires_preorder INTEGER NOT NULL DEFAULT 0;

-- Every pre-existing row was inserted with display_order = 0 (no prior codepath ever
-- wrote display_order), so all rows in a category currently tie. Backfill distinct,
-- per-category display_order values that preserve the existing id ordering, so the
-- new item-reorder (move) endpoint has something meaningful to swap.
UPDATE dine_in_menu_items SET display_order = (
  SELECT COUNT(*) FROM dine_in_menu_items b
  WHERE b.category = dine_in_menu_items.category AND b.id < dine_in_menu_items.id
);
