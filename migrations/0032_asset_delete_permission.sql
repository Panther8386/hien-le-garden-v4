-- v4/migrations/0032_asset_delete_permission.sql
ALTER TABLE staff_accounts ADD COLUMN can_delete_asset INTEGER NOT NULL DEFAULT 0;
