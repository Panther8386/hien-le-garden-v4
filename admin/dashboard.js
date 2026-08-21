// admin/dashboard.js
const STATUS_LABELS = {
  pending: 'Chờ xử lý',
  confirmed: 'Đã xác nhận',
  checked_in: 'Đang ở',
  checked_out: 'Đã trả phòng',
  cancelled: 'Đã huỷ',
};

const SOURCE_LABELS = {
  website: 'Website',
  phone: 'Điện thoại',
  zalo: 'Zalo',
  walk_in: 'Khách vãng lai',
};

function currentMonthValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
}

function formatVnd(amount) {
  return amount.toLocaleString('vi-VN') + 'đ';
}

function showDashboardError(message) {
  document.getElementById('dashboardError').textContent = message || '';
}

function renderStatCards(containerId, cards) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  cards.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'stat-card';
    const value = document.createElement('div');
    value.className = 'stat-value';
    value.textContent = c.value;
    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = c.label;
    div.appendChild(value);
    div.appendChild(label);
    container.appendChild(div);
  });
}

function renderCountTable(tbodySelector, counts, labels) {
  const tbody = document.querySelector(tbodySelector);
  tbody.innerHTML = '';
  Object.entries(counts).forEach(([key, count]) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = labels[key] || key;
    const tdCount = document.createElement('td');
    tdCount.textContent = count;
    tr.appendChild(tdLabel);
    tr.appendChild(tdCount);
    tbody.appendChild(tr);
  });
}

function clearSummary() {
  document.getElementById('todayStats').innerHTML = '';
  document.getElementById('monthStats').innerHTML = '';
  document.querySelector('#funnelTable tbody').innerHTML = '';
  document.querySelector('#sourceTable tbody').innerHTML = '';
}

function renderSummary(data) {
  const [year, monthNum] = data.month.split('-');
  document.getElementById('monthHeading').textContent = `Tháng ${Number(monthNum)}/${year}`;

  renderStatCards('todayStats', [
    { label: 'Đang có khách', value: data.today.roomsOccupied },
    { label: 'Cần dọn', value: data.today.roomsNeedCleaning },
    { label: 'Còn trống', value: data.today.roomsEmpty },
    { label: 'Khách đến hôm nay', value: data.today.arrivalsToday },
    { label: 'Khách đi hôm nay', value: data.today.departuresToday },
  ]);

  renderStatCards('monthStats', [
    { label: 'Tỷ lệ lấp đầy', value: `${Math.round(data.monthSummary.occupancyRate * 100)}%` },
    { label: 'Doanh thu ước tính', value: formatVnd(data.monthSummary.estimatedRevenueVnd) },
  ]);

  renderCountTable('#funnelTable tbody', data.monthSummary.statusFunnel, STATUS_LABELS);
  renderCountTable('#sourceTable tbody', data.monthSummary.sourceBreakdown, SOURCE_LABELS);
}

async function loadSummary(month) {
  clearSummary();
  showDashboardError('');
  let response;
  try {
    response = await fetch(`/api/dashboard/summary?month=${encodeURIComponent(month)}`);
  } catch (err) {
    showDashboardError('Không thể kết nối — vui lòng thử lại.');
    return;
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = 'login.html';
      return;
    }
    const body = await response.json().catch(() => ({}));
    showDashboardError(body.error || 'Có lỗi khi tải số liệu');
    return;
  }
  try {
    const data = await response.json();
    renderSummary(data);
  } catch (err) {
    showDashboardError('Có lỗi khi tải số liệu');
  }
}

(async () => {
  let res;
  try {
    res = await fetch('/api/auth/me');
  } catch (err) {
    showDashboardError('Không thể kết nối — vui lòng thử lại.');
    return;
  }
  if (!res.ok) {
    window.location.href = 'login.html';
    return;
  }

  const monthInput = document.getElementById('monthInput');
  monthInput.value = currentMonthValue();
  monthInput.addEventListener('change', () => loadSummary(monthInput.value));
  await loadSummary(monthInput.value);
})();
