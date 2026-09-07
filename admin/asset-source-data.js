// v4/admin/asset-source-data.js
(async () => {
  let res;
  try {
    res = await fetch('/api/auth/me');
  } catch (err) {
    window.location.href = '/admin';
    return;
  }
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }

  await loadDocuments();
})();

function showPageError(message) {
  document.getElementById('pageError').textContent = message || '';
}

async function loadDocuments() {
  showPageError('');
  let response;
  try {
    response = await fetch('/api/asset-source-documents');
  } catch (err) {
    showPageError('Có lỗi khi tải hồ sơ nguồn');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi tải hồ sơ nguồn');
    return;
  }
  const documents = await response.json();
  const select = document.getElementById('documentSelect');
  select.innerHTML = '';
  documents.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.contractRef ? `${d.title} (${d.contractRef})` : d.title;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => loadSourceRows(select.value));
  if (documents.length > 0) await loadSourceRows(documents[0].id);
}

async function loadSourceRows(documentId) {
  showPageError('');
  let response;
  try {
    response = await fetch(`/api/asset-source-rows?documentId=${documentId}`);
  } catch (err) {
    showPageError('Có lỗi khi tải danh sách hạng mục');
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showPageError(body.error || 'Có lỗi khi tải danh sách hạng mục');
    return;
  }
  const rows = await response.json();
  renderRows(rows);
}

function renderRows(rows) {
  const tbody = document.querySelector('#sourceRowsTable tbody');
  tbody.innerHTML = '';
  let currentGroup = null;
  rows.forEach((r) => {
    if (r.sourceGroupLabel !== currentGroup) {
      currentGroup = r.sourceGroupLabel;
      const groupTr = document.createElement('tr');
      const groupTd = document.createElement('td');
      groupTd.colSpan = 6;
      groupTd.style.fontWeight = '600';
      groupTd.textContent = currentGroup;
      groupTr.appendChild(groupTd);
      tbody.appendChild(groupTr);
    }
    const tr = document.createElement('tr');
    const cells = [
      String(r.stt),
      r.rawName,
      r.rawUnit || '',
      r.rawQuantity !== null && r.rawQuantity !== undefined ? r.rawQuantity : 'Chưa xác định',
      r.rawCondition || '',
      r.rawNote || '',
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}
