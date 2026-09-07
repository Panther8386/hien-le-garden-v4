// Generates the SQL to bootstrap Phase-2 catalog/location/source data.
// Usage:
//   node scripts/import-asset-source-data.js > asset-import.sql
//   wrangler d1 execute hien_le_garden_crm --local --file=./asset-import.sql
//   (use --remote instead of --local to apply to production)
//
// Safe to generate and apply more than once — every statement below is guarded
// with a WHERE NOT EXISTS / duplicate check, so re-running never creates a
// second copy of any row in any of the 4 tables it touches.

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

const now = new Date().toISOString();

const WAREHOUSES = [
  { code: 'BP', name: 'Buồng phòng' },
  { code: 'TB', name: 'Thiết bị & vật tư phụ' },
  { code: 'DK', name: 'Đồ khô & thức uống' },
  { code: 'TP', name: 'Thực phẩm tươi sống' },
  { code: 'NB', name: 'Đồ dùng nhà bếp & phục vụ' },
];

const COMMON_AREAS = [
  { code: 'KDLT', name: 'Khu đốt lửa trại' },
  { code: 'QCF', name: 'Quán cà phê' },
  { code: 'SVAT', name: 'Sân vườn ăn trái' },
  { code: 'KTC', name: 'Khu tiểu cảnh' },
  { code: 'HTKT', name: 'Hạ tầng kỹ thuật' },
];

const SEED_CATEGORIES = [
  { managementType: 'infrastructure', name: 'Công trình / hạng mục xây dựng', defaultUnit: 'hạng mục' },
  { managementType: 'individual_device', name: 'Điều hoà', defaultUnit: 'bộ' },
  { managementType: 'device_set', name: 'Bộ dàn âm thanh', defaultUnit: 'bộ' },
  { managementType: 'durable_goods', name: 'Ghế', defaultUnit: 'cái' },
  { managementType: 'linen', name: 'Khăn', defaultUnit: 'cái' },
  { managementType: 'consumable', name: 'Đồ dùng cá nhân dùng 1 lần', defaultUnit: 'cái' },
  { managementType: 'spare_part', name: 'Vỏ bình gas', defaultUnit: 'bình' },
  { managementType: 'food_beverage', name: 'Nước uống', defaultUnit: 'chai' },
];

const SOURCE_DOCUMENT = {
  title: 'Phụ lục II — Danh mục tài sản hiện tại của Bên A',
  contractRef: '0107/HĐHTKD-HLG/2026',
};

// Trích nguyên văn từ Phụ lục II (D:/VDX/HienLeGarden/Phu_Luc_I_II_V_Hien_Le_garden.docx,
// bảng "DANH MỤC TÀI SẢN HIỆN TẠI CỦA BÊN A", 64 dòng). raw_quantity giữ dạng chuỗi gốc
// (kể cả "01" có số 0 đầu); ô trống trong văn bản gốc -> null, không phải 0.
const SOURCE_ROWS = [
  { group: 'A. CÔNG TRÌNH & KẾT CẤU XÂY DỰNG', stt: 1, name: 'Phòng lưu trú gia đình', unit: 'phòng', qty: '15', condition: 'Tốt', note: null },
  { group: 'A. CÔNG TRÌNH & KẾT CẤU XÂY DỰNG', stt: 2, name: 'Phòng tập thể (dormitory)', unit: 'phòng', qty: '01', condition: 'Tốt', note: null },
  { group: 'A. CÔNG TRÌNH & KẾT CẤU XÂY DỰNG', stt: 3, name: 'Quán cà phê', unit: 'hạng mục', qty: '01', condition: 'Tốt', note: null },
  { group: 'A. CÔNG TRÌNH & KẾT CẤU XÂY DỰNG', stt: 4, name: 'Khu sinh hoạt tập thể / nhà chung', unit: 'hạng mục', qty: null, condition: 'Tốt', note: null },
  { group: 'A. CÔNG TRÌNH & KẾT CẤU XÂY DỰNG', stt: 5, name: 'Nhà vệ sinh – nhà tắm chung (nếu có)', unit: 'hạng mục', qty: null, condition: 'Tốt', note: null },
  { group: 'A. CÔNG TRÌNH & KẾT CẤU XÂY DỰNG', stt: 6, name: 'Cổng, tường rào, đường nội bộ', unit: 'hệ thống', qty: null, condition: 'Tốt', note: null },

  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 7, name: 'Giường 1.4m', unit: 'cái', qty: '2', condition: 'Tốt', note: null },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 8, name: 'Giường 1.6m', unit: 'Cái', qty: '11', condition: 'Tốt', note: null },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 9, name: 'Giường 1.8m', unit: 'Cái', qty: '1', condition: 'Tốt', note: null },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 10, name: 'Nệm', unit: 'cái', qty: '14', condition: 'Tốt', note: null },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 11, name: 'Điều hoà Daikin 2.5HP', unit: 'bộ', qty: '1', condition: 'Tốt', note: 'Vip1' },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 12, name: 'Điều hoà Daikin 2.0HP', unit: 'bộ', qty: '1', condition: 'Tốt', note: 'Sảnh 1' },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 13, name: 'Điều hoà Daikin 1.5HP', unit: 'bộ', qty: '8', condition: 'Tốt', note: '5 nhà tròn + 2 Êđê Cozy + Sảnh 3' },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 14, name: 'Điều hoà LG 2.0HP', unit: 'bộ', qty: '1', condition: 'Tốt', note: 'Vip2' },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 15, name: 'Điều hoà Daikin 1.0HP', unit: 'bộ', qty: '4', condition: 'Tốt', note: '3 nhà tam giác + Sảnh 2' },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 16, name: 'Điều hoà Daikin 4.0HP (âm trần)', unit: 'bộ', qty: '1', condition: 'Tốt', note: 'Sảnh 4 (phòng tập thể)' },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 17, name: 'Tủ lạnh Funiki 130L', unit: 'cái', qty: '1', condition: 'Tốt', note: 'Sảnh 4' },
  { group: 'B. NỘI THẤT & THIẾT BỊ TRONG PHÒNG', stt: 18, name: 'Tủ lạnh mini', unit: 'Cái', qty: '12', condition: 'Tốt', note: null },

  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 19, name: 'Bộ dàn loa di động gồm: 4 loa + Ampli + 2 micro.', unit: null, qty: null, condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 20, name: 'Tủ lạnh Electrolux 394L', unit: 'Cái', qty: '1', condition: 'Tốt', note: 'Sảnh lễ tân' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 21, name: 'Quạt hơi nước', unit: 'Cái', qty: '3', condition: 'Tốt', note: 'Sảnh lễ tân' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 22, name: 'Quạt gió (đứng)', unit: 'Cái', qty: '7', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 23, name: 'Máy giặt Toshiba 14kg', unit: 'Cái', qty: '2', condition: 'Tốt', note: 'Khu giặt là' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 24, name: 'Nệm dự phòng', unit: 'Cái', qty: '8', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 25, name: 'Mềm dự phòng', unit: 'Cái', qty: '20', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 26, name: 'Dra bảo vệ nệm', unit: 'Cái', qty: '18', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 27, name: 'Khăn dự phòng', unit: 'Cái', qty: '50', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 28, name: 'Áo gối dự phòng', unit: 'Cái', qty: '40', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 29, name: 'Dra nệm 1m4 dự phòng', unit: 'Cái', qty: '4', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 30, name: 'Dra nệm 1m6 dự phòng', unit: 'Cái', qty: '25', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 31, name: 'Dra nệm 1m8 dự phòng', unit: 'Cái', qty: '4', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 32, name: 'Bao mền dự phòng', unit: 'Cái', qty: '8', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 33, name: 'Gối dự phòng', unit: 'Cái', qty: '7', condition: 'Tốt', note: 'Kho' },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 34, name: 'Dép dự phòng', unit: 'Cái', qty: '19', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 35, name: 'Ghế gỗ', unit: 'Cái', qty: '37', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 36, name: 'Ghế sắt màu trắng', unit: 'Cái', qty: '28', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 37, name: 'Ghế sắt màu đen', unit: 'Cái', qty: '31', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 38, name: 'Ghế mây', unit: 'Cái', qty: '32', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 39, name: 'Ghế nhựa', unit: 'Cái', qty: '153', condition: 'Khá', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 40, name: 'Bàn cà phê khổ 60cm', unit: 'Cái', qty: '22', condition: 'Khá', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 41, name: 'Bàn cà phê mặt đá khổ 80cm', unit: 'Cái', qty: '15', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 42, name: 'Bàn tiệc', unit: 'Cái', qty: '47', condition: 'Khá', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 43, name: 'Ly uống bia', unit: 'Ly', qty: '120', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 44, name: 'Chén', unit: 'Cái', qty: '120', condition: 'Khá', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 45, name: 'Dĩa các loại', unit: 'Cái', qty: '70', condition: 'Khá', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 46, name: 'Đũa + muỗng các loại', unit: 'Cái', qty: '400', condition: 'Khá', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 47, name: 'Vỏ bình ga bò (lớn)', unit: 'Bình', qty: '3', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 48, name: 'Vỏ bình ga nhở 13kg', unit: 'Bình', qty: '3', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 49, name: 'Bếp ga mini', unit: 'Cái', qty: '16', condition: 'Tốt', note: null },
  { group: 'C. KHU VỰC CHUNG, NGOÀI TRỜI & CẢNH QUAN', stt: 50, name: 'Nồi cơm điện lớn (10L)', unit: 'Cái', qty: '1', condition: 'Tốt', note: null },

  { group: 'D. HẠ TẦNG KỸ THUẬT', stt: 51, name: 'Hệ thống điện (công tơ, tủ điện, dây dẫn)', unit: 'hệ thống', qty: null, condition: 'Đang hoạt động bình thường.', note: 'Chỉ số ghi tại PL V' },
  { group: 'D. HẠ TẦNG KỸ THUẬT', stt: 52, name: 'Hệ thống cấp – thoát nước', unit: 'hệ thống', qty: null, condition: 'Đang hoạt động bình thường.', note: null },
  { group: 'D. HẠ TẦNG KỸ THUẬT', stt: 53, name: 'Camera an ninh', unit: 'cái', qty: null, condition: 'Đang hoạt động bình thường.', note: null },
  { group: 'D. HẠ TẦNG KỸ THUẬT', stt: 54, name: 'Internet / wifi (modem, AP)', unit: 'bộ', qty: null, condition: 'Đang hoạt động bình thường.', note: null },
  { group: 'D. HẠ TẦNG KỸ THUẬT', stt: 55, name: 'Máy bơm nước / bồn chứa', unit: 'cái', qty: null, condition: 'Đang hoạt động bình thường.', note: null },

  { group: 'E. TÀI SẢN KHÁC', stt: 56, name: 'Bộ bàn đá + 6 ghế đá', unit: 'Bộ', qty: '1', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 57, name: 'Máy cắt cỏ (Shinda Wha)', unit: 'Cái', qty: '2', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 58, name: 'Xe máy Honda biển số 52L2 1539', unit: 'Xe máy', qty: '1', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 59, name: 'Xe wave dùng di chuyển nội khu.', unit: 'Xe máy', qty: '1', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 60, name: 'Lược', unit: 'Cái', qty: '500', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 61, name: 'Bàn chải đánh răng', unit: 'Cái', qty: '900', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 62, name: 'Bao chụp tóc', unit: 'Cái', qty: '500', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 63, name: 'Tăm bông', unit: 'Bịch', qty: '100', condition: 'Tốt', note: null },
  { group: 'E. TÀI SẢN KHÁC', stt: 64, name: 'Khăn lạnh', unit: 'Cái', qty: '150', condition: 'Tốt', note: null },
];

const lines = [];
lines.push('-- Generated by scripts/import-asset-source-data.js — safe to re-run, every statement is guarded.');

// 1. asset_locations from existing rooms (one per room, code = P + zero-padded
// display_order — matching the ordering rooms are already presented in elsewhere
// in the app, e.g. functions/api/rooms/index.js's `ORDER BY display_order, id`).
lines.push(`
INSERT INTO asset_locations (location_type, room_id, code, name, created_by, created_at)
SELECT 'room', id, 'P' || printf('%02d', display_order), name, 'system', ${sqlString(now)}
FROM rooms
WHERE NOT EXISTS (SELECT 1 FROM asset_locations WHERE asset_locations.room_id = rooms.id);
`.trim());

// 2. Warehouse + common-area seed locations.
for (const w of WAREHOUSES) {
  lines.push(`
INSERT INTO asset_locations (location_type, code, name, created_by, created_at)
SELECT 'warehouse', ${sqlString(w.code)}, ${sqlString(w.name)}, 'system', ${sqlString(now)}
WHERE NOT EXISTS (SELECT 1 FROM asset_locations WHERE location_type = 'warehouse' AND code = ${sqlString(w.code)});
`.trim());
}
for (const c of COMMON_AREAS) {
  lines.push(`
INSERT INTO asset_locations (location_type, code, name, created_by, created_at)
SELECT 'common_area', ${sqlString(c.code)}, ${sqlString(c.name)}, 'system', ${sqlString(now)}
WHERE NOT EXISTS (SELECT 1 FROM asset_locations WHERE location_type = 'common_area' AND code = ${sqlString(c.code)});
`.trim());
}

// 3. Seed example categories (one per management_type) — admin can add/edit/deactivate freely afterward.
for (const cat of SEED_CATEGORIES) {
  lines.push(`
INSERT INTO asset_categories (management_type, name, default_unit, created_by, created_at)
SELECT ${sqlString(cat.managementType)}, ${sqlString(cat.name)}, ${sqlString(cat.defaultUnit)}, 'system', ${sqlString(now)}
WHERE NOT EXISTS (SELECT 1 FROM asset_categories WHERE management_type = ${sqlString(cat.managementType)} AND name = ${sqlString(cat.name)});
`.trim());
}

// 4. Source document (one row).
lines.push(`
INSERT INTO asset_source_documents (title, contract_ref, created_by, created_at)
SELECT ${sqlString(SOURCE_DOCUMENT.title)}, ${sqlString(SOURCE_DOCUMENT.contractRef)}, 'system', ${sqlString(now)}
WHERE NOT EXISTS (SELECT 1 FROM asset_source_documents WHERE title = ${sqlString(SOURCE_DOCUMENT.title)});
`.trim());

// 5. Source rows — 64 rows, tied to the document by title lookup (works whether the
// document above was just inserted or already existed from a prior run).
for (const row of SOURCE_ROWS) {
  lines.push(`
INSERT INTO asset_source_rows (source_document_id, source_group_label, stt, raw_name, raw_unit, raw_quantity, raw_condition, raw_note, created_at)
SELECT id, ${sqlString(row.group)}, ${row.stt}, ${sqlString(row.name)}, ${sqlString(row.unit)}, ${sqlString(row.qty)}, ${sqlString(row.condition)}, ${sqlString(row.note)}, ${sqlString(now)}
FROM asset_source_documents WHERE title = ${sqlString(SOURCE_DOCUMENT.title)}
AND NOT EXISTS (
  SELECT 1 FROM asset_source_rows
  WHERE asset_source_rows.source_document_id = asset_source_documents.id AND asset_source_rows.stt = ${row.stt}
);
`.trim());
}

console.log(lines.join('\n\n'));
