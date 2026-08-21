// admin/customers.js
(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = 'login.html';
  }
})();

let currentPage = 1;
const pageSize = 25;
let allTemplates = [];
let selectedFeedbackId = null;

const statusLabel = { unused: 'Còn hạn', used: 'Đã dùng', expired: 'Hết hạn' };

async function loadCustomers() {
  const search = document.getElementById('searchInput').value.trim();
  const status = document.getElementById('statusFilter').value;
  const params = new URLSearchParams({ page: String(currentPage), pageSize: String(pageSize) });
  if (search) params.set('search', search);
  if (status) params.set('status', status);

  const response = await fetch(`/api/customers?${params.toString()}`);
  const listError = document.getElementById('listError');
  listError.textContent = '';

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    listError.textContent = body.error || 'Có lỗi khi tải danh sách khách hàng';
    return;
  }

  const { results, total } = await response.json();
  const tbody = document.querySelector('#customerTable tbody');
  tbody.innerHTML = '';

  results.forEach((c) => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const tdName = document.createElement('td');
    tdName.textContent = c.guestName;

    const tdPhone = document.createElement('td');
    tdPhone.textContent = c.phone;

    const tdRating = document.createElement('td');
    tdRating.textContent = c.rating;

    const tdPromoCode = document.createElement('td');
    tdPromoCode.textContent = c.promoCode;

    const tdDiscount = document.createElement('td');
    tdDiscount.textContent = `${c.discountPercent}%`;

    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `status-badge status-${c.promoStatus}`;
    statusSpan.textContent = statusLabel[c.promoStatus];
    tdStatus.appendChild(statusSpan);

    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(c.submittedAt).toLocaleDateString('vi-VN');

    tr.append(tdName, tdPhone, tdRating, tdPromoCode, tdDiscount, tdStatus, tdDate);
    tr.addEventListener('click', () => showDetail(c.feedbackId));
    tbody.appendChild(tr);
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  document.getElementById('pageInfo').textContent = `Trang ${currentPage}/${totalPages} (${total} khách)`;
  document.getElementById('prevPage').disabled = currentPage <= 1;
  document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

document.getElementById('searchInput').addEventListener('input', () => { currentPage = 1; loadCustomers(); });
document.getElementById('statusFilter').addEventListener('change', () => { currentPage = 1; loadCustomers(); });
document.getElementById('prevPage').addEventListener('click', () => { currentPage -= 1; loadCustomers(); });
document.getElementById('nextPage').addEventListener('click', () => { currentPage += 1; loadCustomers(); });

async function loadTemplates() {
  const response = await fetch('/api/templates');
  if (response.ok) {
    allTemplates = await response.json();
  }
}

function refreshTemplateOptions(hasTelegramChatId) {
  const channelSelect = document.getElementById('sendChannel');
  const telegramOption = channelSelect.querySelector('option[value="telegram"]');
  telegramOption.disabled = !hasTelegramChatId;
  telegramOption.title = hasTelegramChatId ? '' : 'Khách chưa kết nối Telegram';
  if (!hasTelegramChatId && channelSelect.value === 'telegram') {
    channelSelect.value = 'email';
  }
  updateTemplateOptions();
}

function updateTemplateOptions() {
  const channel = document.getElementById('sendChannel').value;
  const templateSelect = document.getElementById('sendTemplate');
  templateSelect.innerHTML = '';
  allTemplates
    .filter((t) => t.channel === channel)
    .forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name + (t.isActive ? ' (active)' : '');
      templateSelect.appendChild(opt);
    });
}
document.getElementById('sendChannel').addEventListener('change', updateTemplateOptions);

async function showDetail(feedbackId) {
  selectedFeedbackId = feedbackId;
  const response = await fetch(`/api/customers/${feedbackId}`);
  if (!response.ok) return;
  const detail = await response.json();

  document.getElementById('detailPanel').classList.remove('hidden');

  const detailContent = document.getElementById('detailContent');
  detailContent.innerHTML = '';

  const pComment = document.createElement('p');
  pComment.textContent = `Ghi chú trải nghiệm: ${detail.comment || '(không có)'}`;
  detailContent.appendChild(pComment);

  const pStayDate = document.createElement('p');
  pStayDate.textContent = `Ngày lưu trú: ${detail.stayDate || '(không có)'}`;
  detailContent.appendChild(pStayDate);

  const pWishes = document.createElement('p');
  pWishes.textContent = `Mong muốn lần sau: ${detail.wishesNextTime || '(không có)'}`;
  detailContent.appendChild(pWishes);

  const pActivities = document.createElement('p');
  pActivities.textContent = `Hoạt động yêu thích: ${detail.favoriteActivities.join(', ') || '(không có)'}`;
  detailContent.appendChild(pActivities);

  const pGift = document.createElement('p');
  pGift.textContent = `Quà tặng: ${detail.giftOffered ? (detail.giftClaimed ? 'Đã phát' : 'Chưa phát') : 'Không có'}`;
  detailContent.appendChild(pGift);

  refreshTemplateOptions(detail.hasTelegramChatId);

  const history = document.getElementById('messageHistory');
  history.innerHTML = '';
  if (detail.messageHistory.length) {
    detail.messageHistory.forEach((h) => {
      const p = document.createElement('p');
      p.textContent = `${new Date(h.sentAt).toLocaleString('vi-VN')} — ${h.channel} — ${h.templateName || '(template đã xoá)'} — ${h.status === 'success' ? '✅' : '❌'} — bởi ${h.sentBy}`;
      history.appendChild(p);
    });
  } else {
    const p = document.createElement('p');
    p.textContent = 'Chưa có tin nhắn nào được gửi.';
    history.appendChild(p);
  }
}

document.getElementById('sendForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const sendError = document.getElementById('sendError');
  const sendSuccess = document.getElementById('sendSuccess');
  sendError.textContent = '';
  sendSuccess.textContent = '';

  const templateId = Number(document.getElementById('sendTemplate').value);
  const response = await fetch(`/api/customers/${selectedFeedbackId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    sendError.textContent = body.error || 'Có lỗi khi gửi tin nhắn';
    return;
  }

  const body = await response.json();
  sendSuccess.textContent = body.ok ? 'Đã gửi thành công!' : 'Gửi thất bại — kiểm tra lại kênh gửi.';
  await showDetail(selectedFeedbackId);
});

loadTemplates();
loadCustomers();
