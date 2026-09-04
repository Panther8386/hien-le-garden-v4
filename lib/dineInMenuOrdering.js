// v4/lib/dineInMenuOrdering.js
//
// Món cùng (category, subgroup) luôn phải là 1 khối display_order liên tục -- đây là bất biến
// bắt buộc để việc gộp nhóm hiển thị (client) và di chuyển cả nhóm (move-group endpoint) hoạt
// động đúng. Hàm này tính thứ tự MỚI (chỉ gồm id các món hiện có + 1 vị trí `null` đánh dấu món
// đang chèn/di chuyển) sao cho món đó luôn nằm cuối khối nhóm đích, giữ nguyên thứ tự nội bộ mọi
// khối khác.
export function computeInsertionOrder(existingItems, targetSubgroup) {
  const blocks = [];
  existingItems.forEach((it) => {
    const key = it.subgroup || null;
    const last = blocks[blocks.length - 1];
    if (last && last.key === key) {
      last.ids.push(it.id);
    } else {
      blocks.push({ key, ids: [it.id] });
    }
  });

  const normalizedTarget = targetSubgroup || null;
  const matchingBlockIndex = blocks.findIndex((b) => b.key === normalizedTarget);

  const orderedIds = [];
  if (matchingBlockIndex === -1) {
    blocks.forEach((b) => b.ids.forEach((id) => orderedIds.push(id)));
    orderedIds.push(null);
  } else {
    blocks.forEach((b, idx) => {
      b.ids.forEach((id) => orderedIds.push(id));
      if (idx === matchingBlockIndex) orderedIds.push(null);
    });
  }
  return orderedIds;
}
