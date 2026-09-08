-- v4/migrations/0030_booking_service_dine_in_item.sql

-- Lets a booking service line reference a Menu Quán item (dine_in_menu_items)
-- instead of a Bảng giá dịch vụ item (service_catalog). Nullable, like
-- service_catalog_id already is: the API enforces that exactly one of the
-- two is set on any given row, not the schema.
ALTER TABLE booking_service_items ADD COLUMN dine_in_menu_item_id INTEGER REFERENCES dine_in_menu_items(id);
