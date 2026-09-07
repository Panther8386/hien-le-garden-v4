-- v4/migrations/0028_finance_transaction_permission.sql
ALTER TABLE staff_accounts ADD COLUMN can_add_finance_transaction INTEGER NOT NULL DEFAULT 0;
