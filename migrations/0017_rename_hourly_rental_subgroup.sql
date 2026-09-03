-- Rename the "Thuê Theo Giờ" (hourly rental) service_catalog subgroup to the
-- new brand name "Giờ Xanh Hiền Lê" across all 3 rows in that subgroup.
UPDATE service_catalog
SET subgroup = 'Giờ Xanh Hiền Lê'
WHERE category = 'luu_tru' AND subgroup = 'Thuê Theo Giờ';
