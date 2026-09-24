// admin/users.js — trang Phân quyền (tab Tài khoản / Vai trò).
// Mọi quy tắc ở đây chỉ để giao diện gọn; server kiểm tra lại từng thao tác
// (functions/api/users/**, functions/api/roles/**) và thông báo lỗi của server
// luôn được hiện nguyên văn.

const ROLE_LABELS = { reception: 'Lễ tân', manager: 'Quản lý', observer: 'Người quan sát', admin: 'Quản trị' };
const ROLE_ORDER = ['reception', 'manager', 'observer', 'admin'];
const EDITABLE_ROLES = ['reception', 'manager', 'observer'];

const state = {
  me: { username: '', role: '', permissions: [] },
  users: [],
  groups: [],
  canEditRoles: false,
  roleSaved: {},   // role -> Set(permission) as stored on the server
  roleDraft: {},   // role -> Set(permission) being edited in tab Vai trò
  selectedId: null,
  detail: null,    // { role, overrides } as loaded for selectedId
  draft: {},       // key -> 'grant' | 'deny' being edited
  pendingRole: null,
  panel: null,     // null | 'reset' | 'delete'
  busy: false,
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function iHave(key) { return state.me.permissions.includes(key); }
function meIsAdmin() { return state.me.role === 'admin'; }
function selectedUser() { return state.users.find((u) => u.id === state.selectedId) || null; }
function allKeys() { return state.groups.flatMap((g) => g.permissions.map((p) => p.key)); }
function roleHas(role, key) { return role === 'admin' || (state.roleSaved[role] ? state.roleSaved[role].has(key) : false); }

// Rule 6 (server-enforced): a non-admin may only assign a role whose every
// permission they hold themselves; only an admin may assign the admin role.
function canAssignRole(role) {
  if (meIsAdmin()) return true;
  if (role === 'admin') return false;
  return [...(state.roleSaved[role] || [])].every(iHave);
}

async function readError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return body.error || fallback;
}

async function send(url, method, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetch(url, init);
}

let noticeTimer = null;
function showNotice(message) {
  const notice = $('notice');
  notice.textContent = message;
  notice.classList.remove('hidden');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.add('hidden'), 4000);
}

// ---------------------------------------------------------------- loading

async function loadUsers() {
  const response = await fetch('/api/users');
  if (!response.ok) {
    $('listError').textContent = await readError(response, 'Có lỗi khi tải danh sách tài khoản');
    return false;
  }
  state.users = await response.json();
  renderUserList();
  return true;
}

async function loadCatalog() {
  const response = await fetch('/api/permissions');
  if (!response.ok) {
    $('listError').textContent = await readError(response, 'Có lỗi khi tải danh mục quyền');
    return false;
  }
  const data = await response.json();
  state.groups = data.groups || [];
  state.canEditRoles = !!data.canEditRoles;
  EDITABLE_ROLES.forEach((role) => {
    state.roleSaved[role] = new Set((data.roles && data.roles[role]) || []);
    state.roleDraft[role] = new Set(state.roleSaved[role]);
  });
  return true;
}

async function loadDetail(id) {
  const response = await fetch(`/api/users/${id}/permissions`);
  if (state.selectedId !== id) return;
  if (!response.ok) {
    state.detail = null;
    renderDetail();
    $('actionError').textContent = await readError(response, 'Có lỗi khi tải quyền của tài khoản');
    return;
  }
  const data = await response.json();
  state.detail = { role: data.role, overrides: data.overrides || {} };
  state.draft = { ...state.detail.overrides };
  renderDetail();
}

// ---------------------------------------------------------------- user list

function renderUserList() {
  const list = $('userList');
  list.innerHTML = '';
  if (state.users.length === 0) {
    list.appendChild(el('li', { className: 'pq-muted', text: 'Chưa có tài khoản nào.' }));
    return;
  }
  state.users.forEach((u) => {
    const nameLine = el('span', { className: 'pq-uname' }, [u.username]);
    if (u.overrideCount > 0) {
      nameLine.appendChild(el('em', { className: 'pq-badge pq-badge-warn', title: `${u.overrideCount} quyền khác vai trò`, text: `+${u.overrideCount}` }));
    }
    if (u.lockedAt) nameLine.appendChild(el('em', { className: 'pq-badge pq-badge-danger', text: 'Đang khoá' }));
    const button = el('button', {
      type: 'button',
      className: 'pq-uitem' + (u.id === state.selectedId ? ' on' : ''),
      'aria-current': u.id === state.selectedId ? 'true' : null,
      'data-user-id': String(u.id),
      onclick: () => selectUser(u.id),
    }, [nameLine, el('small', { text: `${ROLE_LABELS[u.role] || u.role} · 2FA ${u.totpEnabled ? 'bật' : 'tắt'}` })]);
    list.appendChild(el('li', {}, button));
  });
}

function selectUser(id) {
  state.selectedId = id;
  state.detail = null;
  state.draft = {};
  state.pendingRole = null;
  state.panel = null;
  renderUserList();
  $('accountsLayout').classList.add('pq-show-detail');
  renderDetail();
  loadDetail(id);
}

function backToList() {
  const id = state.selectedId;
  $('accountsLayout').classList.remove('pq-show-detail');
  const item = document.querySelector(`.pq-uitem[data-user-id="${id}"]`);
  if (item) item.focus();
}

// ---------------------------------------------------------------- detail

function diffCount() {
  return Object.keys(state.draft).length;
}

function draftChanged() {
  const a = state.draft;
  const b = (state.detail && state.detail.overrides) || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].some((k) => a[k] !== b[k]);
}

function renderDetail() {
  const box = $('userDetail');
  const user = selectedUser();
  box.innerHTML = '';
  if (!user) {
    box.appendChild(el('p', { className: 'pq-muted', text: 'Chọn một tài khoản để xem và chỉnh quyền.' }));
    return;
  }

  const isSelf = user.username === state.me.username;
  const targetIsAdmin = user.role === 'admin';
  const hideActions = isSelf || (targetIsAdmin && !meIsAdmin());

  const title = el('div', { className: 'pq-detail-title' }, [el('h2', { text: user.username })]);
  if (user.lockedAt) title.appendChild(el('span', { className: 'pq-badge pq-badge-danger', text: 'Đang khoá' }));

  box.appendChild(el('button', { type: 'button', className: 'pq-back pq-btn pq-btn-ghost', onclick: backToList, text: '‹ Danh sách' }));
  box.appendChild(title);

  // Role + actions row
  const meta = el('div', { className: 'pq-meta' });
  if (hideActions) {
    meta.appendChild(el('span', { text: `Vai trò: ${ROLE_LABELS[user.role] || user.role} · 2FA ${user.totpEnabled ? 'bật' : 'tắt'}` }));
  } else {
    const select = el('select', { id: 'roleSelect', 'aria-label': 'Vai trò', onchange: onRoleSelect });
    ROLE_ORDER.forEach((role) => {
      if (role === 'admin' && !meIsAdmin()) return;
      const opt = el('option', { value: role, text: ROLE_LABELS[role] });
      if (role !== user.role && !canAssignRole(role)) {
        opt.disabled = true;
        opt.textContent = `${ROLE_LABELS[role]} (bạn không có đủ quyền)`;
      }
      opt.selected = role === (state.pendingRole || user.role);
      select.appendChild(opt);
    });
    meta.appendChild(el('label', { className: 'pq-inline' }, ['Vai trò ', select]));

    meta.appendChild(el('button', {
      type: 'button', className: 'pq-btn pq-btn-secondary',
      onclick: () => (user.lockedAt ? unlockUser(user) : lockUser(user)),
      text: user.lockedAt ? 'Mở khoá' : 'Khoá tài khoản',
    }));
    if (iHave('users.security')) {
      meta.appendChild(el('button', { type: 'button', className: 'pq-btn pq-btn-secondary', onclick: () => openPanel('reset'), text: 'Đặt lại mật khẩu' }));
      if (user.totpEnabled) {
        meta.appendChild(el('button', { type: 'button', className: 'pq-btn pq-btn-secondary', onclick: () => disable2fa(user), text: 'Tắt 2FA' }));
      }
    }
    meta.appendChild(el('button', { type: 'button', className: 'pq-btn pq-btn-danger', onclick: () => openPanel('delete'), text: 'Xoá tài khoản' }));
  }
  box.appendChild(meta);

  if (isSelf) {
    box.appendChild(el('p', { className: 'pq-hint', text: 'Đây là tài khoản của bạn: không tự đổi vai trò, khoá, xoá hay chỉnh quyền của chính mình.' }));
  }

  if (state.pendingRole) box.appendChild(renderRoleConfirm(user));
  if (state.panel === 'reset') box.appendChild(renderResetPanel(user));
  if (state.panel === 'delete') box.appendChild(renderDeletePanel(user));
  box.appendChild(el('p', { id: 'actionError', className: 'pq-error', role: 'alert' }));

  if (targetIsAdmin) {
    box.appendChild(el('p', { className: 'pq-all', text: 'Quản trị có toàn quyền' }));
    return;
  }
  if (!state.detail) {
    box.appendChild(el('p', { className: 'pq-muted', text: 'Đang tải quyền…' }));
    return;
  }
  box.appendChild(renderPermList(user, isSelf));
  if (!isSelf) {
    const n = diffCount();
    const changed = draftChanged();
    box.appendChild(el('div', { className: 'pq-foot' }, [
      el('span', { text: `${n} quyền khác vai trò` }),
      el('span', { className: 'pq-actions' }, [
        el('button', { type: 'button', className: 'pq-btn pq-btn-secondary', disabled: !changed || state.busy, onclick: resetDraft, text: 'Huỷ' }),
        el('button', { type: 'button', className: 'pq-btn', disabled: !changed || state.busy, onclick: saveOverrides, text: 'Lưu thay đổi' }),
      ]),
    ]));
    box.appendChild(el('p', { id: 'permError', className: 'pq-error', role: 'alert' }));
  }
}

function renderPermList(user, readOnly) {
  const wrap = el('div', { className: 'pq-perms' });
  state.groups.forEach((group) => {
    wrap.appendChild(el('h3', { className: 'pq-mod', text: group.label }));
    group.permissions.forEach((perm) => {
      const has = roleHas(user.role, perm.key);
      const value = state.draft[perm.key] || 'role';
      const differs = value !== 'role';
      const labelNode = el('span', { className: 'pq-perm-label', id: `perm-${perm.key}` }, [perm.label]);
      if (differs) labelNode.appendChild(el('span', { className: 'pq-st', text: ` · vai trò: ${has ? 'có' : 'không'}` }));

      const seg = el('div', { className: 'pq-seg', role: 'radiogroup', 'aria-labelledby': `perm-${perm.key}` });
      const options = [{ val: 'role', text: value === 'role' ? `Theo vai trò: ${has ? 'có' : 'không'}` : 'Theo vai trò' }];
      // Rule 3: only offer "Cho" for permissions the acting user holds (an
      // existing grant stays visible so it can be kept or removed).
      if (iHave(perm.key) || (state.detail.overrides[perm.key] === 'grant')) options.push({ val: 'grant', text: 'Cho' });
      options.push({ val: 'deny', text: 'Chặn' });
      options.forEach((o) => {
        const checked = o.val === value;
        let tone = '';
        if (checked && o.val === 'grant') tone = ' yes';
        if (checked && o.val === 'deny') tone = ' no';
        seg.appendChild(el('button', {
          type: 'button',
          role: 'radio',
          className: 'pq-seg-opt' + (checked ? ' on' : '') + tone,
          'aria-checked': checked ? 'true' : 'false',
          tabindex: checked ? '0' : '-1',
          disabled: readOnly,
          'data-key': perm.key,
          'data-val': o.val,
          onclick: () => setDraft(perm.key, o.val),
          onkeydown: onSegKey,
          text: o.text,
        }));
      });
      wrap.appendChild(el('div', { className: 'pq-perm' + (differs ? ' changed' : '') }, [labelNode, seg]));
    });
  });
  return wrap;
}

function onSegKey(event) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(event.key in keys)) return;
  event.preventDefault();
  const buttons = [...event.currentTarget.parentElement.querySelectorAll('.pq-seg-opt')];
  const index = buttons.indexOf(event.currentTarget);
  const next = buttons[(index + keys[event.key] + buttons.length) % buttons.length];
  setDraft(next.dataset.key, next.dataset.val);
}

function setDraft(key, value) {
  if (value === 'role') delete state.draft[key];
  else state.draft[key] = value;
  renderDetail();
  const target = document.querySelector(`.pq-seg-opt[data-key="${key}"][data-val="${value}"]`);
  if (target) target.focus();
}

function resetDraft() {
  state.draft = { ...state.detail.overrides };
  renderDetail();
}

async function saveOverrides() {
  const user = selectedUser();
  if (!user || state.busy) return;
  state.busy = true;
  const overrides = { ...state.draft };
  let response;
  try {
    response = await send(`/api/users/${user.id}/permissions`, 'PUT', { overrides });
  } catch (err) {
    state.busy = false;
    renderDetail();
    $('permError').textContent = 'Không kết nối được máy chủ';
    return;
  }
  state.busy = false;
  if (!response.ok) {
    const message = await readError(response, 'Có lỗi khi lưu quyền');
    renderDetail();
    $('permError').textContent = message;
    return;
  }
  state.detail.overrides = overrides;
  showNotice(`Đã lưu quyền của ${user.username}`);
  await loadUsers();
  renderDetail();
}

// ---------------------------------------------------------------- role change

function onRoleSelect(event) {
  const user = selectedUser();
  const role = event.target.value;
  if (!user || role === user.role) {
    state.pendingRole = null;
    renderDetail();
    return;
  }
  const overrideCount = Object.keys((state.detail && state.detail.overrides) || {}).length;
  if (overrideCount > 0) {
    state.pendingRole = role;
    renderDetail();
    const confirmBtn = document.querySelector('#roleConfirm .pq-btn');
    if (confirmBtn) confirmBtn.focus();
    return;
  }
  changeRole(user, role);
}

function renderRoleConfirm(user) {
  const n = Object.keys((state.detail && state.detail.overrides) || {}).length;
  return el('div', { id: 'roleConfirm', className: 'pq-confirm', role: 'group', 'aria-label': 'Xác nhận đổi vai trò' }, [
    el('span', { text: `Đổi vai trò sẽ xoá ${n} quyền chỉnh riêng. Tiếp tục?` }),
    el('span', { className: 'pq-actions' }, [
      el('button', { type: 'button', className: 'pq-btn', onclick: () => changeRole(user, state.pendingRole), text: 'Đổi vai trò' }),
      el('button', { type: 'button', className: 'pq-btn pq-btn-secondary', onclick: () => { state.pendingRole = null; renderDetail(); }, text: 'Giữ nguyên' }),
    ]),
  ]);
}

async function changeRole(user, role) {
  const response = await send(`/api/users/${user.id}/role`, 'PATCH', { role }).catch(() => null);
  state.pendingRole = null;
  if (!response || !response.ok) {
    const message = response ? await readError(response, 'Có lỗi khi đổi vai trò') : 'Không kết nối được máy chủ';
    renderDetail();
    $('actionError').textContent = message;
    return;
  }
  showNotice(`Đã đổi vai trò của ${user.username} thành ${ROLE_LABELS[role]}`);
  await loadUsers();
  state.detail = null;
  renderDetail();
  await loadDetail(user.id);
}

// ---------------------------------------------------------------- account actions

function openPanel(name) {
  state.panel = state.panel === name ? null : name;
  renderDetail();
  const focusTarget = document.querySelector('.pq-panel input, .pq-panel .pq-btn');
  if (focusTarget) focusTarget.focus();
}

async function runAction(user, url, method, body, success, fallback) {
  const response = await send(url, method, body).catch(() => null);
  if (!response || !response.ok) {
    const message = response ? await readError(response, fallback) : 'Không kết nối được máy chủ';
    renderDetail();
    $('actionError').textContent = message;
    return false;
  }
  state.panel = null;
  showNotice(success);
  await loadUsers();
  renderDetail();
  return true;
}

function lockUser(user) {
  return runAction(user, `/api/users/${user.id}/lock`, 'POST', undefined, `Đã khoá tài khoản ${user.username}`, 'Có lỗi khi khoá tài khoản');
}

function unlockUser(user) {
  return runAction(user, `/api/users/${user.id}/unlock`, 'POST', undefined, `Đã mở khoá tài khoản ${user.username}`, 'Có lỗi khi mở khoá tài khoản');
}

function disable2fa(user) {
  return runAction(user, `/api/users/${user.id}/disable-2fa`, 'PATCH', undefined, `Đã tắt 2FA của ${user.username}`, 'Có lỗi khi tắt 2FA');
}

function renderResetPanel(user) {
  const input = el('input', { type: 'password', id: 'resetPasswordInput', minlength: '8', autocomplete: 'new-password', placeholder: 'Tối thiểu 8 ký tự' });
  const error = el('p', { className: 'pq-error', role: 'alert' });
  const submit = async (event) => {
    event.preventDefault();
    error.textContent = '';
    if (input.value.length < 8) {
      error.textContent = 'Mật khẩu phải có ít nhất 8 ký tự';
      return;
    }
    const response = await send(`/api/users/${user.id}/password`, 'PATCH', { password: input.value }).catch(() => null);
    if (!response || !response.ok) {
      error.textContent = response ? await readError(response, 'Có lỗi khi đặt lại mật khẩu') : 'Không kết nối được máy chủ';
      return;
    }
    state.panel = null;
    renderDetail();
    showNotice(`Đã đặt lại mật khẩu của ${user.username}`);
  };
  return el('form', { className: 'pq-panel', onsubmit: submit }, [
    el('label', {}, [`Mật khẩu mới cho ${user.username}`, input]),
    el('span', { className: 'pq-actions' }, [
      el('button', { type: 'submit', className: 'pq-btn', text: 'Đặt lại mật khẩu' }),
      el('button', { type: 'button', className: 'pq-btn pq-btn-secondary', onclick: () => openPanel('reset'), text: 'Huỷ' }),
    ]),
    error,
  ]);
}

function renderDeletePanel(user) {
  const doDelete = async () => {
    const response = await send(`/api/users/${user.id}`, 'DELETE').catch(() => null);
    if (!response || !response.ok) {
      const message = response ? await readError(response, 'Có lỗi khi xoá tài khoản') : 'Không kết nối được máy chủ';
      renderDetail();
      $('actionError').textContent = message;
      return;
    }
    state.selectedId = null;
    state.detail = null;
    state.panel = null;
    $('accountsLayout').classList.remove('pq-show-detail');
    showNotice(`Đã xoá tài khoản ${user.username}`);
    await loadUsers();
    renderDetail();
  };
  return el('div', { className: 'pq-panel pq-confirm pq-confirm-danger', role: 'group', 'aria-label': 'Xác nhận xoá tài khoản' }, [
    el('span', { text: `Xoá tài khoản ${user.username}? Không thể hoàn tác.` }),
    el('span', { className: 'pq-actions' }, [
      el('button', { type: 'button', className: 'pq-btn pq-btn-danger', onclick: doDelete, text: 'Xoá tài khoản' }),
      el('button', { type: 'button', className: 'pq-btn pq-btn-secondary', onclick: () => openPanel('delete'), text: 'Huỷ' }),
    ]),
  ]);
}

// ---------------------------------------------------------------- create account

function renderCreateRoleOptions() {
  const select = $('createRole');
  select.innerHTML = '';
  ROLE_ORDER.forEach((role) => {
    if (role === 'admin' && !meIsAdmin()) return;
    const opt = el('option', { value: role, text: ROLE_LABELS[role] });
    if (!canAssignRole(role)) {
      opt.disabled = true;
      opt.textContent = `${ROLE_LABELS[role]} (bạn không có đủ quyền)`;
    }
    select.appendChild(opt);
  });
  const firstEnabled = [...select.options].find((o) => !o.disabled);
  if (firstEnabled) select.value = firstEnabled.value;
}

function toggleCreate(open) {
  $('createPanel').classList.toggle('hidden', !open);
  $('openCreateBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('formError').textContent = '';
  if (open) $('userForm').querySelector('input[name="username"]').focus();
}

$('openCreateBtn').addEventListener('click', () => toggleCreate($('createPanel').classList.contains('hidden')));
$('cancelCreateBtn').addEventListener('click', () => { $('userForm').reset(); renderCreateRoleOptions(); toggleCreate(false); });

$('userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const errorEl = $('formError');
  errorEl.textContent = '';
  const username = String(data.get('username') || '').trim();
  const password = String(data.get('password') || '');
  if (!username) { errorEl.textContent = 'Tên đăng nhập không được để trống'; return; }
  if (password.length < 8) { errorEl.textContent = 'Mật khẩu phải có ít nhất 8 ký tự'; return; }

  const response = await send('/api/users', 'POST', { username, password, role: data.get('role') }).catch(() => null);
  if (!response || !response.ok) {
    errorEl.textContent = response ? await readError(response, 'Có lỗi khi tạo tài khoản') : 'Không kết nối được máy chủ';
    return;
  }
  const { id } = await response.json();
  form.reset();
  renderCreateRoleOptions();
  toggleCreate(false);
  showNotice(`Đã tạo tài khoản ${username}`);
  switchTab('accounts');
  await loadUsers();
  selectUser(id);
});

// ---------------------------------------------------------------- tab Vai trò

function roleDirtyCount() {
  let n = 0;
  EDITABLE_ROLES.forEach((role) => {
    const saved = state.roleSaved[role];
    const draft = state.roleDraft[role];
    allKeys().forEach((key) => { if (saved.has(key) !== draft.has(key)) n += 1; });
  });
  return n;
}

function renderRoleTable() {
  const tbody = document.querySelector('#roleTable tbody');
  tbody.innerHTML = '';
  state.groups.forEach((group) => {
    tbody.appendChild(el('tr', { className: 'pq-group' }, el('td', { colspan: '5' }, el('span', { text: group.label }))));
    group.permissions.forEach((perm) => {
      const row = el('tr', {}, el('th', { scope: 'row', text: perm.label }));
      EDITABLE_ROLES.forEach((role) => {
        const checked = state.roleDraft[role].has(perm.key);
        const changed = checked !== state.roleSaved[role].has(perm.key);
        const box = el('input', {
          type: 'checkbox',
          className: 'pq-check',
          'aria-label': `${ROLE_LABELS[role]}: ${perm.label}`,
          'data-role': role,
          'data-key': perm.key,
        });
        box.checked = checked;
        box.addEventListener('change', () => {
          if (box.checked) state.roleDraft[role].add(perm.key);
          else state.roleDraft[role].delete(perm.key);
          box.parentElement.classList.toggle('changed', box.checked !== state.roleSaved[role].has(perm.key));
          renderRolesFooter();
        });
        row.appendChild(el('td', { className: changed ? 'changed' : null }, box));
      });
      const adminBox = el('input', { type: 'checkbox', className: 'pq-check', 'aria-label': `Quản trị: ${perm.label} (luôn có)`, disabled: true });
      adminBox.checked = true;
      row.appendChild(el('td', {}, adminBox));
      tbody.appendChild(row);
    });
  });
  renderRolesFooter();
}

function renderRolesFooter() {
  const n = roleDirtyCount();
  $('rolesDirtyText').textContent = n > 0 ? `Có ${n} thay đổi chưa lưu` : 'Không có thay đổi';
  $('saveRolesBtn').disabled = n === 0 || state.busy;
  const badge = $('rolesDirtyCount');
  badge.textContent = String(n);
  badge.classList.toggle('hidden', n === 0);
}

$('saveRolesBtn').addEventListener('click', async () => {
  if (state.busy) return;
  state.busy = true;
  $('rolesError').textContent = '';
  renderRolesFooter();
  const order = allKeys();
  for (const role of EDITABLE_ROLES) {
    const saved = state.roleSaved[role];
    const draft = state.roleDraft[role];
    if (order.every((k) => saved.has(k) === draft.has(k))) continue;
    const permissions = order.filter((k) => draft.has(k));
    const response = await send(`/api/roles/${role}/permissions`, 'PUT', { permissions }).catch(() => null);
    if (!response || !response.ok) {
      $('rolesError').textContent = response ? await readError(response, 'Có lỗi khi lưu bảng quyền') : 'Không kết nối được máy chủ';
      state.busy = false;
      renderRoleTable();
      return;
    }
    state.roleSaved[role] = new Set(permissions);
  }
  state.busy = false;
  renderRoleTable();
  showNotice('Đã lưu bảng quyền');
  if (state.selectedId !== null) renderDetail();
});

// ---------------------------------------------------------------- tabs

function switchTab(name) {
  const accounts = name === 'accounts';
  $('tabAccounts').setAttribute('aria-selected', accounts ? 'true' : 'false');
  $('tabAccounts').tabIndex = accounts ? 0 : -1;
  $('tabRoles').setAttribute('aria-selected', accounts ? 'false' : 'true');
  $('tabRoles').tabIndex = accounts ? -1 : 0;
  $('panelAccounts').classList.toggle('hidden', !accounts);
  $('panelRoles').classList.toggle('hidden', accounts);
}

$('tabAccounts').addEventListener('click', () => switchTab('accounts'));
$('tabRoles').addEventListener('click', () => switchTab('roles'));
document.querySelector('.pq-tabs').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  if ($('tabRoles').classList.contains('hidden')) return;
  const toRoles = document.activeElement === $('tabAccounts');
  switchTab(toRoles ? 'roles' : 'accounts');
  (toRoles ? $('tabRoles') : $('tabAccounts')).focus();
});

// ---------------------------------------------------------------- start

(async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/admin';
    return;
  }
  const me = await res.json();
  state.me = { username: me.username, role: me.role, permissions: me.permissions || [] };
  if (!state.me.permissions.includes('users.manage')) return; // nav-drawer.js redirects away

  const [catalogOk] = await Promise.all([loadCatalog(), loadUsers()]);
  if (!catalogOk) return;
  renderCreateRoleOptions();
  if (state.canEditRoles) {
    $('tabRoles').classList.remove('hidden');
    renderRoleTable();
  }
})();
