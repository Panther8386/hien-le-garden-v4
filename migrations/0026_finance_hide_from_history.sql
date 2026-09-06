-- v4/migrations/0026_finance_hide_from_history.sql

ALTER TABLE finance_transactions ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
