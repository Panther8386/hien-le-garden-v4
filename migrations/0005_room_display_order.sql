ALTER TABLE rooms ADD COLUMN display_order INTEGER;

UPDATE rooms SET display_order = id;
