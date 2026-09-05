// v4/admin/gio-xanh.js
let currentRole = null;

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
  const { role } = await res.json();
  currentRole = role;

  await loadSessions();
  await loadSessionHistory();

  if (currentRole !== 'observer') {
    document.getElementById('openSessionForm').classList.remove('hidden');
    await populateRoomSelect();
  }

  if (currentRole === 'admin') {
    document.getElementById('showHiddenSessionsWrap').classList.remove('hidden');
  }
  document.getElementById('showHiddenSessions').addEventListener('change', loadSessionHistory);
})();

async function populateRoomSelect() {
  const select = document.querySelector('#openSessionForm select[name="roomId"]');
  select.innerHTML = '<option value="">-- Chọn phòng --</option>';

  let roomsResponse, sessionsResponse;
  try {
    [roomsResponse, sessionsResponse] = await Promise.all([
      fetch('/api/rooms'),
      fetch('/api/gio-xanh-sessions?status=open'),
    ]);
  } catch (err) {
    document.getElementById('pageError').textContent = 'Có lỗi khi tải danh sách phòng';
    return;
  }
  if (!roomsResponse.ok) {
    document.getElementById('pageError').textContent = 'Có lỗi khi tải danh sách phòng';
    return;
  }
  const rooms = await roomsResponse.json();
  const openSessions = sessionsResponse.ok ? await sessionsResponse.json() : [];
  const busyRoomIds = new Set(openSessions.map((s) => s.roomId));

  rooms.filter((r) => !busyRoomIds.has(r.id)).forEach((r) => {
    const option = document.createElement('option');
    option.value = r.id;
    option.textContent = r.name;
    select.appendChild(option);
  });
}

async function loadSessions() {
  const errorEl = document.getElementById('pageError');
  errorEl.textContent = '';
  let response;
  try {
    response = await fetch('/api/gio-xanh-sessions?status=open');
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải danh sách phiên';
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi tải danh sách phiên';
    return;
  }
  const sessions = await response.json();
  renderGrid(sessions);
}

function renderGrid(sessions) {
  const grid = document.getElementById('sessionsGrid');
  const emptyState = document.getElementById('emptyState');
  grid.innerHTML = '';
  if (sessions.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  sessions.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'gio-xanh-card';

    const roomLabel = document.createElement('div');
    roomLabel.className = 'room-label';
    roomLabel.textContent = s.roomName;

    const guestLabel = document.createElement('div');
    guestLabel.textContent = s.guestName;

    const total = document.createElement('div');
    total.className = 'session-total';
    total.textContent = `${s.currentTotal.toLocaleString('vi-VN')}đ`;

    const opened = document.createElement('div');
    opened.textContent = `Mở lúc: ${new Date(s.openedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

    card.append(roomLabel, guestLabel, total, opened);
    card.addEventListener('click', () => {
      window.location.href = `/admin/gio-xanh-detail.html?sessionId=${s.id}`;
    });
    grid.appendChild(card);
  });
}

document.getElementById('openSessionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('openSessionError');
  errorEl.textContent = '';
  const form = event.target;
  const roomId = Number(form.querySelector('[name="roomId"]').value);
  const guestName = form.querySelector('[name="guestName"]').value.trim();
  const phone = form.querySelector('[name="phone"]').value.trim();
  if (!roomId) {
    errorEl.textContent = 'Vui lòng chọn phòng';
    return;
  }
  if (!guestName) {
    errorEl.textContent = 'Vui lòng nhập tên khách';
    return;
  }
  const response = await fetch('/api/gio-xanh-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, guestName, phone: phone || undefined }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    errorEl.textContent = body.error || 'Có lỗi khi mở phiên';
    return;
  }
  const result = await response.json();
  window.location.href = `/admin/gio-xanh-detail.html?sessionId=${result.id}`;
});

async function loadSessionHistory() {
  const errorEl = document.getElementById('pageError');
  const showHidden = currentRole === 'admin' && document.getElementById('showHiddenSessions').checked;
  const suffix = showHidden ? '&includeHidden=1' : '';
  let closedRes, voidedRes;
  try {
    [closedRes, voidedRes] = await Promise.all([
      fetch(`/api/gio-xanh-sessions?status=closed${suffix}`),
      fetch(`/api/gio-xanh-sessions?status=voided${suffix}`),
    ]);
  } catch (err) {
    errorEl.textContent = 'Có lỗi khi tải lịch sử phiên';
    return;
  }
  if (!closedRes.ok || !voidedRes.ok) {
    errorEl.textContent = 'Có lỗi khi tải lịch sử phiên';
    return;
  }
  const closed = await closedRes.json();
  const voided = await voidedRes.json();
  const all = [...closed, ...voided].sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  renderHistoryGrid(all);
}

function renderHistoryGrid(sessions) {
  const grid = document.getElementById('sessionHistoryGrid');
  const emptyState = document.getElementById('historyEmptyState');
  grid.innerHTML = '';
  if (sessions.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  sessions.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'gio-xanh-card';
    if (s.isHidden) card.style.opacity = '0.5';

    const roomLabel = document.createElement('div');
    roomLabel.className = 'room-label';
    roomLabel.textContent = s.roomName;

    const guestLabel = document.createElement('div');
    guestLabel.textContent = s.guestName;

    const statusLabel = document.createElement('div');
    statusLabel.textContent = s.status === 'closed' ? 'Đã chốt' : 'Đã huỷ';

    const total = document.createElement('div');
    total.className = 'session-total';
    total.textContent = `${s.currentTotal.toLocaleString('vi-VN')}đ`;

    card.append(roomLabel, guestLabel, statusLabel, total);

    if (currentRole === 'admin') {
      const hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.className = 'btn-secondary table-actions-btn';
      hideBtn.textContent = s.isHidden ? 'Hiện' : 'Ẩn';
      hideBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const errorEl = document.getElementById('pageError');
        errorEl.textContent = '';
        const response = await fetch(`/api/gio-xanh-sessions/${s.id}/hide`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hidden: !s.isHidden }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          errorEl.textContent = body.error || 'Có lỗi khi ẩn/hiện phiên';
          return;
        }
        await loadSessionHistory();
      });
      card.appendChild(hideBtn);
    }

    card.addEventListener('click', () => {
      window.location.href = `/admin/gio-xanh-detail.html?sessionId=${s.id}`;
    });
    grid.appendChild(card);
  });
}
