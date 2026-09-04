-- v4/migrations/0022_dine_in_menu_items_grouping.sql

ALTER TABLE dine_in_menu_items ADD COLUMN subgroup TEXT;
ALTER TABLE dine_in_menu_items ADD COLUMN unit TEXT;
ALTER TABLE dine_in_menu_items ADD COLUMN requires_preorder INTEGER NOT NULL DEFAULT 0;
