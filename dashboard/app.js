const tokenKey = 'unovaFirebaseToken';
const shell = document.querySelector('.shell');
const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const firebaseLoginButton = document.getElementById('firebaseLoginButton');
const authLabel = document.getElementById('authLabel');
const passwordForm = document.getElementById('passwordForm');
const passwordNotice = document.getElementById('passwordNotice');
const playersList = document.getElementById('playersList');
const selectedPanel = document.getElementById('selectedPanel');
const emptySelection = document.getElementById('emptySelection');
const selectedName = document.getElementById('selectedName');
const selectedMeta = document.getElementById('selectedMeta');
const reason = document.getElementById('reason');
const actionNotice = document.getElementById('actionNotice');
const spectatePanel = document.getElementById('spectatePanel');
const spectateImage = document.getElementById('spectateImage');
const spectateStatus = document.getElementById('spectateStatus');
const stopSpectateButton = document.getElementById('stopSpectateButton');
const serverName = document.getElementById('serverName');
const serverCount = document.getElementById('serverCount');
const serverUpdated = document.getElementById('serverUpdated');
const queueCount = document.getElementById('queueCount');
const actionsQueueCount = document.getElementById('actionsQueueCount');
const statOnline = document.getElementById('statOnline');
const statQueue = document.getElementById('statQueue');
const statUpdated = document.getElementById('statUpdated');
const actionsList = document.getElementById('actionsList');
const playersView = document.getElementById('playersView');
const actionsView = document.getElementById('actionsView');
const announcementsView = document.getElementById('announcementsView');
const ticketsView = document.getElementById('ticketsView');
const loaView = document.getElementById('loaView');
const priorityView = document.getElementById('priorityView');
const settingsView = document.getElementById('settingsView');
const announcementsNavButton = document.getElementById('announcementsNavButton');
const settingsNavButton = document.getElementById('settingsNavButton');
const founderSettingsPanel = document.getElementById('founderSettingsPanel');
const founderCleanupPanel = document.getElementById('founderCleanupPanel');
const firebaseUsersList = document.getElementById('firebaseUsersList');
const firebaseUsersNotice = document.getElementById('firebaseUsersNotice');
const priorityRoleForm = document.getElementById('priorityRoleForm');
const priorityOverrideForm = document.getElementById('priorityOverrideForm');
const priorityRulesList = document.getElementById('priorityRulesList');
const priorityOverridesList = document.getElementById('priorityOverridesList');
const ticketsNavButton = document.getElementById('ticketsNavButton');
const ticketsList = document.getElementById('ticketsList');
const founderLoaForm = document.getElementById('founderLoaForm');
const loaMemberSelect = document.getElementById('loaMemberSelect');
const founderLoaNotice = document.getElementById('founderLoaNotice');
const founderLoaSubmitButton = document.getElementById('founderLoaSubmitButton');
const pendingLoaList = document.getElementById('pendingLoaList');
const loaList = document.getElementById('loaList');
const displayNameInput = document.getElementById('displayName');
const announcementForm = document.getElementById('announcementForm');
const announcementNotice = document.getElementById('announcementNotice');
const announcementSubmitButton = document.getElementById('announcementSubmitButton');
const announcementImageFile = document.getElementById('announcementImageFile');

let authToken = localStorage.getItem(tokenKey);
let players = [];
let selectedPlayer = null;
let refreshTimer = null;
let spectateTimer = null;
let spectateSessionId = null;
let spectatePollInFlight = false;
let firebaseAuth = null;
let dashboardUser = null;
let loaManagementMembersLoaded = false;

function setAuthState(isAuthed) {
  shell.classList.toggle('locked', !isAuthed);
  loginView.classList.toggle('hidden', isAuthed);
  appView.classList.toggle('hidden', !isAuthed);
  if (isAuthed) {
    loadStatus();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadStatus, 10000);
  } else {
    clearInterval(refreshTimer);
  }
}

function setLoginError(message) {
  loginError.textContent = message || '';
}

function formatRole(value) {
  return String(value || 'staff')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function roleRank(value) {
  return {
    staff: 1,
    senior_staff: 2,
    staff_manager: 3,
    server_manager: 4,
    co_owner: 5,
    owner: 6,
    founder: 7
  }[value] || 0;
}

function canManagePriority() {
  return roleRank(dashboardUser?.role) >= roleRank('founder');
}

function canViewTickets() {
  return roleRank(dashboardUser?.role) >= roleRank('co_owner');
}

function canPostAnnouncements() {
  return roleRank(dashboardUser?.role) >= roleRank('staff');
}

function describeFirebaseError(error) {
  const code = error?.code || 'unknown';
  const messages = {
    'auth/invalid-email': 'Enter a valid Firebase username.',
    'auth/invalid-credential': 'Email or password is wrong.',
    'auth/user-not-found': 'No Firebase user exists for that email.',
    'auth/wrong-password': 'Email or password is wrong.',
    'auth/too-many-requests': 'Too many attempts. Wait a bit and try again.',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase Authentication.',
    'auth/requires-recent-login': 'Log out, log back in, then change the password.',
    'auth/weak-password': 'Use a stronger password with at least 8 characters.',
    'auth/web-storage-unsupported': 'This browser is blocking storage needed for Firebase sign-in.'
  };
  return `${messages[code] || 'Firebase sign-in could not complete.'} (${code})`;
}

async function completeFirebaseLogin(user) {
  const idToken = await user.getIdToken(true);
  const loginResponse = await fetch('/auth/firebase-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });

  if (!loginResponse.ok) {
    const error = await loginResponse.json().catch(() => ({}));
    setLoginError(error.message || 'This Firebase user needs a dashboard role in Firebase.');
    return false;
  }

  const data = await loginResponse.json();
  authToken = idToken;
  dashboardUser = data.user || null;
  authLabel.textContent = dashboardUser?.role
    ? `${formatRole(dashboardUser.role)} Access`
    : 'Firebase Password Access';
  localStorage.setItem(tokenKey, authToken);
  setAuthState(true);
  return true;
}

async function refreshFirebaseToken(force = false) {
  if (!firebaseAuth?.currentUser) return authToken;
  authToken = await firebaseAuth.currentUser.getIdToken(force);
  localStorage.setItem(tokenKey, authToken);
  return authToken;
}

async function api(path, options = {}) {
  await refreshFirebaseToken(false).catch(() => null);
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {})
    }
  });
}

function formatUpdated(value) {
  if (!value) return 'Waiting for FiveM';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Updated recently';
  return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function renderStatus(data) {
  if (data.user) {
    dashboardUser = data.user;
    authLabel.textContent = dashboardUser.role
      ? `${dashboardUser.name ? `${dashboardUser.name} / ` : ''}${formatRole(dashboardUser.role)} Access`
      : 'Firebase Password Access';
    founderSettingsPanel.classList.toggle('hidden', dashboardUser.role !== 'founder');
    founderCleanupPanel.classList.toggle('hidden', dashboardUser.role !== 'founder');
    founderLoaForm?.classList.toggle('hidden', dashboardUser.role !== 'founder');
    ticketsNavButton.classList.toggle('hidden', !canViewTickets());
    announcementsNavButton.classList.toggle('hidden', !canPostAnnouncements());
    if (displayNameInput && !displayNameInput.value) displayNameInput.value = dashboardUser.name || '';
    if (dashboardUser.role === 'founder') loadFirebaseUsers();
    if (dashboardUser.role === 'founder') loadLoaManagementMembers();
  }

  const fivem = data.fivem || {};
  players = data.players || fivem.players || [];
  const onlinePlayers = fivem.onlinePlayers || players.length;
  const maxPlayers = fivem.maxPlayers || 0;
  const queueLength = data.queueLength || 0;
  const updatedLabel = formatUpdated(fivem.updatedAt);
  serverName.textContent = fivem.serverName || 'Unova';
  serverCount.textContent = `${onlinePlayers} / ${maxPlayers}`;
  serverUpdated.textContent = updatedLabel;
  queueCount.textContent = queueLength;
  actionsQueueCount.textContent = `Queue ${queueLength}`;
  statOnline.textContent = String(onlinePlayers);
  statQueue.textContent = String(queueLength);
  statUpdated.textContent = updatedLabel.replace('Updated ', '');

  if (selectedPlayer) {
    selectedPlayer = players.find((player) => player.id === selectedPlayer.id) || null;
    if (!selectedPlayer) clearSelection();
  }

  renderPlayers();
  renderActions(data.recentActions || []);
  renderTickets(data.openTickets || []);
  renderLoas(data.loas || [], data.pendingLoas || []);
}

function renderPriority(data) {
  const rules = data.rules || [];
  const overrides = data.overrides || [];
  const lockedMessage = canManagePriority() ? '' : '<small class="muted">Founder required to edit priority.</small>';
  priorityRoleForm.querySelectorAll('input, button').forEach((item) => {
    item.disabled = !canManagePriority();
  });
  priorityOverrideForm.querySelectorAll('input, button').forEach((item) => {
    item.disabled = !canManagePriority();
  });

  priorityRulesList.innerHTML = lockedMessage || '';
  if (!rules.length) {
    priorityRulesList.innerHTML += '<div><span>No priority roles yet.</span><b>-</b></div>';
  }
  for (const rule of rules) {
    const item = document.createElement('div');
    item.innerHTML = `<span>${escapeHtml(rule.label)}<small>${escapeHtml(rule.roleId)}</small></span><b>${rule.points}</b>`;
    if (canManagePriority()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', () => deletePriorityRule(rule.roleId));
      item.appendChild(button);
    }
    priorityRulesList.appendChild(item);
  }

  priorityOverridesList.innerHTML = lockedMessage || '';
  if (!overrides.length) {
    priorityOverridesList.innerHTML += '<div><span>No user overrides yet.</span><b>-</b></div>';
  }
  for (const override of overrides) {
    const item = document.createElement('div');
    item.innerHTML = `<span>${escapeHtml(override.label)}<small>${escapeHtml(override.discordId)}</small></span><b>${override.points}</b>`;
    if (canManagePriority()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Remove';
      button.addEventListener('click', () => deletePriorityOverride(override.discordId));
      item.appendChild(button);
    }
    priorityOverridesList.appendChild(item);
  }
}

async function loadPriority() {
  if (!authToken) return;
  const response = await api('/dashboard/priority').catch(() => null);
  if (!response || !response.ok) return;
  renderPriority(await response.json());
}

function renderPlayers() {
  playersList.innerHTML = '';

  if (!players.length) {
    const row = document.createElement('div');
    row.className = 'player-row muted';
    row.innerHTML = '<span>No online players reported yet.</span><span>-</span><span>-</span><span>-</span>';
    playersList.appendChild(row);
    return;
  }

  for (const player of players) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `player-row${selectedPlayer && selectedPlayer.id === player.id ? ' active' : ''}`;
    row.innerHTML = [
      `<span><b>${escapeHtml(player.name || 'Unknown')}</b><small>${escapeHtml(player.license || 'No license')}</small></span>`,
      `<span>${player.id || '-'}</span>`,
      `<span>${player.discordId || 'not linked'}</span>`,
      `<span>${player.ping || '-'}</span>`
    ].join('');
    row.addEventListener('click', () => selectPlayer(player));
    playersList.appendChild(row);
  }
}

function renderActions(actions) {
  actionsList.innerHTML = '';

  if (!actions.length) {
    const item = document.createElement('div');
    item.className = 'action-item muted';
    item.innerHTML = '<span></span><span>No recent moderation actions.</span><span></span>';
    actionsList.appendChild(item);
    return;
  }

  for (const action of actions) {
    const item = document.createElement('div');
    item.className = 'action-item';
    const targetDiscord = action.targetDiscordName || action.discordId || 'not linked';
    const moderator = action.moderatorDiscordName || action.moderatorDisplayName || action.moderatorDiscordId || 'Management';
    const target = `${action.playerName || 'Unknown target'} (${targetDiscord})`;
    item.innerHTML = [
      `<span class="badge ${action.action}">${action.action}</span>`,
      `<span><b>${escapeHtml(moderator)}</b> ${escapeHtml(action.action)} ${escapeHtml(target)} - ${escapeHtml(action.reason || '')}</span>`,
      `<span class="muted">${new Date(action.createdAt).toLocaleString()}</span>`
    ].join('');
    actionsList.appendChild(item);
  }
}

function renderTickets(tickets) {
  ticketsList.innerHTML = '';

  if (!canViewTickets()) {
    ticketsList.innerHTML = '<div class="action-item muted"><span></span><span>Leadership access required.</span><span></span></div>';
    return;
  }

  if (!tickets.length) {
    ticketsList.innerHTML = '<div class="action-item muted"><span></span><span>No ongoing tickets.</span><span></span></div>';
    return;
  }

  for (const ticket of tickets) {
    const item = document.createElement('div');
    item.className = 'action-item';
    const link = ticket.guildId && ticket.channelId
      ? `https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`
      : '#';
    item.innerHTML = [
      `<span class="badge">${escapeHtml(ticket.kind || 'ticket')}</span>`,
      `<span><b>${escapeHtml(ticket.channelName || 'ticket')}</b> ${escapeHtml(ticket.targetName || ticket.openerName || '')}<small>${escapeHtml(ticket.level || '')} / ${escapeHtml(ticket.source || '')}</small></span>`,
      `<span><a href="${link}" target="_blank" rel="noreferrer">Open</a></span>`
    ].join('');
    ticketsList.appendChild(item);
  }
}

async function loadLoaManagementMembers(force = false) {
  if (dashboardUser?.role !== 'founder' || !loaMemberSelect) return;
  if (loaManagementMembersLoaded && !force) return;

  loaMemberSelect.disabled = true;
  loaMemberSelect.innerHTML = '<option value="">Loading management members...</option>';
  founderLoaNotice.textContent = '';

  try {
    const response = await api('/dashboard/loas/management-members');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load management members.');

    const members = data.members || [];
    loaMemberSelect.innerHTML = members.length
      ? '<option value="">Select management member...</option>'
      : '<option value="">No management members found</option>';
    for (const member of members) {
      const option = document.createElement('option');
      option.value = member.discordId;
      option.textContent = member.displayName || member.username || member.discordId;
      loaMemberSelect.appendChild(option);
    }
    loaManagementMembersLoaded = true;
  } catch (error) {
    loaMemberSelect.innerHTML = '<option value="">Could not load management members</option>';
    founderLoaNotice.textContent = error.message || 'Could not load management members.';
  } finally {
    loaMemberSelect.disabled = false;
  }
}

function renderLoas(loas, pendingLoas = []) {
  pendingLoaList.innerHTML = '';
  loaList.innerHTML = '';

  if (dashboardUser?.role === 'founder') {
    if (!pendingLoas.length) {
      pendingLoaList.innerHTML = '<div class="action-item muted"><span class="badge loa">Pending</span><span>No pending LOA requests.</span><span></span></div>';
    } else {
      for (const loa of pendingLoas) {
        const item = document.createElement('div');
        item.className = 'action-item';
        item.innerHTML = [
          '<span class="badge loa pending">Pending</span>',
          `<span><b>${escapeHtml(loa.displayName || 'Unova Management')}</b> <small>${escapeHtml(loa.reason || 'No reason provided')}</small></span>`,
          `<span><button type="button">Approve</button><small>${escapeHtml(loa.from || '')} to ${escapeHtml(loa.to || '')}</small></span>`
        ].join('');
        item.querySelector('button').addEventListener('click', () => approveLoa(loa.discordId));
        pendingLoaList.appendChild(item);
      }
    }
  }

  if (!loas.length) {
    loaList.innerHTML = '<div class="action-item muted"><span class="badge loa">Active</span><span>No approved active LOAs.</span><span></span></div>';
    return;
  }

  for (const loa of loas) {
    const item = document.createElement('div');
    item.className = 'action-item';
    item.innerHTML = [
      '<span class="badge loa">Active</span>',
      `<span><b>${escapeHtml(loa.displayName || 'Unova Management')}</b> <small>${escapeHtml(loa.reason || 'No reason provided')}</small></span>`,
      `<span class="muted">${escapeHtml(loa.from || '')} to ${escapeHtml(loa.to || '')}</span>`
    ].join('');
    loaList.appendChild(item);
  }
}

async function approveLoa(discordId) {
  if (dashboardUser?.role !== 'founder') return;
  const response = await api('/dashboard/loas/approve', {
    method: 'POST',
    body: JSON.stringify({ discordId })
  }).catch(() => null);
  if (response?.ok) await loadStatus();
}

async function pollSpectateFrame() {
  if (!spectateSessionId || spectatePollInFlight) return;
  spectatePollInFlight = true;

  try {
    const response = await api(`/dashboard/spectate/${spectateSessionId}`).catch(() => null);
    if (!response || !response.ok) {
      spectateStatus.textContent = 'Spectate feed unavailable.';
      return;
    }

    const data = await response.json();
    const session = data.session || {};
    if (session.image) {
      spectateImage.src = session.image;
      spectateStatus.textContent = `Viewing ${session.playerName || 'player'}${session.updatedAt ? ` | ${new Date(session.updatedAt).toLocaleTimeString()}` : ''}`;
    } else if (session.error) {
      spectateStatus.textContent = session.error;
    } else {
      spectateStatus.textContent = 'Waiting for screenshot feed.';
    }
  } finally {
    spectatePollInFlight = false;
  }
}

async function stopWebsiteSpectate() {
  if (spectateTimer) clearInterval(spectateTimer);
  spectateTimer = null;
  if (spectateSessionId) {
    await api(`/dashboard/spectate/${spectateSessionId}/stop`, { method: 'POST' }).catch(() => null);
  }
  spectateSessionId = null;
  spectatePollInFlight = false;
  spectatePanel.classList.add('hidden');
  spectateImage.removeAttribute('src');
}

async function startWebsiteSpectate(player) {
  await stopWebsiteSpectate();
  spectatePanel.classList.remove('hidden');
  spectateStatus.textContent = 'Starting website spectate...';
  const response = await api('/dashboard/spectate/start', {
    method: 'POST',
    body: JSON.stringify({
      playerId: player.id,
      playerName: player.name
    })
  }).catch(() => null);

  if (!response || !response.ok) {
    spectateStatus.textContent = 'Could not start website spectate.';
    return;
  }

  const data = await response.json();
  spectateSessionId = data.session?.id;
  spectateTimer = setInterval(pollSpectateFrame, 100);
  await pollSpectateFrame();
}

function roleOptions(selectedRole) {
  const roles = ['', 'staff', 'senior_staff', 'staff_manager', 'server_manager', 'co_owner', 'owner', 'founder'];
  return roles.map((role) => {
    const label = role ? formatRole(role) : 'No Dashboard Access';
    return `<option value="${role}"${role === selectedRole ? ' selected' : ''}>${label}</option>`;
  }).join('');
}

function renderFirebaseUsers(users) {
  firebaseUsersList.innerHTML = '';

  if (!users.length) {
    firebaseUsersList.innerHTML = '<div><span>No Firebase users found.</span><b>-</b></div>';
    return;
  }

  for (const user of users) {
    const item = document.createElement('div');
    item.className = 'user-role-item';
    item.innerHTML = [
      `<span><b>${escapeHtml(user.name || 'Firebase user')}</b><small>${escapeHtml(user.email || 'No email')}</small></span>`,
      `<input data-user-name="${escapeHtml(user.uid)}" type="text" value="${escapeHtml(user.name || '')}" placeholder="Dashboard name">`,
      `<select data-user-role="${escapeHtml(user.uid)}">${roleOptions(user.role || '')}</select>`,
      `<button type="button" data-save-user-role="${escapeHtml(user.uid)}">Save</button>`
    ].join('');
    firebaseUsersList.appendChild(item);
  }
}

async function loadFirebaseUsers() {
  if (dashboardUser?.role !== 'founder' || !firebaseUsersList) return;
  firebaseUsersNotice.textContent = '';
  const response = await api('/dashboard/users').catch(() => null);
  if (!response || !response.ok) {
    firebaseUsersList.innerHTML = '<div><span>Could not load Firebase users.</span><b>-</b></div>';
    return;
  }
  const data = await response.json();
  renderFirebaseUsers(data.users || []);
}

function selectPlayer(player) {
  selectedPlayer = player;
  selectedName.textContent = player.name || 'Unknown';
  selectedMeta.textContent = `FiveM ID ${player.id || '-'} / Discord ${player.discordId || 'not linked'} / ${player.license || 'no license'}`;
  emptySelection.classList.add('hidden');
  selectedPanel.classList.remove('hidden');
  actionNotice.textContent = '';
  renderPlayers();
}

function clearSelection() {
  selectedPlayer = null;
  emptySelection.classList.remove('hidden');
  selectedPanel.classList.add('hidden');
  stopWebsiteSpectate();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
      reject(new Error('Use a PNG, JPG, GIF, or WebP image.'));
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('Image upload must be 8MB or smaller.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      dataUrl: String(reader.result || '')
    });
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

async function loadStatus() {
  if (!authToken) return;

  const response = await api('/dashboard/status').catch(() => null);
  if (!response || response.status === 401 || response.status === 403) {
    localStorage.removeItem(tokenKey);
    authToken = null;
    setAuthState(false);
    return;
  }

  if (!response.ok) return;
  renderStatus(await response.json());
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!firebaseAuth) {
    setLoginError('Firebase is still loading. Try again in a second.');
    return;
  }

  const formData = new FormData(loginForm);
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  if (!email || !password) {
    setLoginError('Username and password are required.');
    return;
  }

  setLoginError('');
  firebaseLoginButton.disabled = true;
  firebaseLoginButton.textContent = 'Checking...';

  try {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const ok = await completeFirebaseLogin(credential.user);
    if (ok) loginForm.reset();
  } catch (error) {
    setLoginError(describeFirebaseError(error));
  } finally {
    firebaseLoginButton.disabled = false;
    firebaseLoginButton.textContent = 'Log In';
  }
});

document.getElementById('logoutButton').addEventListener('click', () => {
  localStorage.removeItem(tokenKey);
  authToken = null;
  dashboardUser = null;
  if (firebaseAuth) {
    firebaseAuth.signOut().catch(() => null);
  }
  setAuthState(false);
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!firebaseAuth?.currentUser) return;

  const formData = new FormData(passwordForm);
  const displayName = String(formData.get('displayName') || '').trim();
  const currentPassword = String(formData.get('currentPassword') || '');
  const newPassword = String(formData.get('newPassword') || '');
  passwordNotice.textContent = '';

  try {
    const {
      EmailAuthProvider,
      reauthenticateWithCredential,
      updateProfile,
      updatePassword
    } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    if (displayName && displayName !== firebaseAuth.currentUser.displayName) {
      await updateProfile(firebaseAuth.currentUser, { displayName });
    }
    const credential = EmailAuthProvider.credential(firebaseAuth.currentUser.email, currentPassword);
    await reauthenticateWithCredential(firebaseAuth.currentUser, credential);
    await updatePassword(firebaseAuth.currentUser, newPassword);
    await refreshFirebaseToken(true);
    passwordForm.reset();
    displayNameInput.value = displayName;
    passwordNotice.textContent = 'Profile saved and password changed.';
    await loadStatus();
  } catch (error) {
    passwordNotice.textContent = describeFirebaseError(error);
  }
});

document.getElementById('refreshButton').addEventListener('click', loadStatus);

document.querySelectorAll('.nav button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const view = button.dataset.view;
    playersView.classList.toggle('hidden', view !== 'players');
    actionsView.classList.toggle('hidden', view !== 'actions');
    announcementsView.classList.toggle('hidden', view !== 'announcements');
    ticketsView.classList.toggle('hidden', view !== 'tickets');
    loaView.classList.toggle('hidden', view !== 'loa');
    priorityView.classList.toggle('hidden', view !== 'priority');
    settingsView.classList.toggle('hidden', view !== 'settings');
    if (view === 'priority') loadPriority();
    if (view === 'loa') loadLoaManagementMembers();
  });
});

founderLoaForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (dashboardUser?.role !== 'founder') return;

  founderLoaNotice.textContent = 'Creating approved LOA...';
  founderLoaSubmitButton.disabled = true;

  try {
    const data = Object.fromEntries(new FormData(founderLoaForm));
    const response = await api('/dashboard/loas/create', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not create LOA.');

    founderLoaForm.reset();
    founderLoaNotice.textContent = 'LOA created and marked active.';
    await loadStatus();
  } catch (error) {
    founderLoaNotice.textContent = error.message || 'Could not create LOA.';
  } finally {
    founderLoaSubmitButton.disabled = false;
  }
});

announcementForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!canPostAnnouncements()) return;

  announcementNotice.textContent = 'Posting announcement...';
  announcementSubmitButton.disabled = true;

  try {
    const data = Object.fromEntries(new FormData(announcementForm));
    const upload = await readImageFile(announcementImageFile.files?.[0]);
    const response = await api('/dashboard/announcements', {
      method: 'POST',
      body: JSON.stringify({
        title: data.title,
        authorName: data.authorName,
        message: data.message,
        color: data.color,
        roleId: data.roleId,
        imageUrl: data.imageUrl,
        upload
      })
    }).catch(() => null);

    if (!response || !response.ok) {
      const error = response ? await response.json().catch(() => ({})) : {};
      announcementNotice.textContent = error.error || 'Announcement failed.';
      return;
    }

    const posted = await response.json();
    announcementForm.reset();
    document.getElementById('announcementColor').value = '#28d7e8';
    announcementNotice.innerHTML = posted.url
      ? `Announcement posted. <a href="${posted.url}" target="_blank" rel="noreferrer">Open in Discord</a>`
      : 'Announcement posted.';
  } catch (error) {
    announcementNotice.textContent = error.message || 'Announcement failed.';
  } finally {
    announcementSubmitButton.disabled = false;
  }
});

priorityRoleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!canManagePriority()) return;
  const data = Object.fromEntries(new FormData(priorityRoleForm));
  const response = await api('/dashboard/priority/rules', {
    method: 'POST',
    body: JSON.stringify(data)
  }).catch(() => null);
  if (response?.ok) {
    priorityRoleForm.reset();
    await loadPriority();
  }
});

priorityOverrideForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!canManagePriority()) return;
  const data = Object.fromEntries(new FormData(priorityOverrideForm));
  const response = await api('/dashboard/priority/overrides', {
    method: 'POST',
    body: JSON.stringify(data)
  }).catch(() => null);
  if (response?.ok) {
    priorityOverrideForm.reset();
    await loadPriority();
  }
});

async function deletePriorityRule(roleId) {
  await api('/dashboard/priority/rules/delete', {
    method: 'POST',
    body: JSON.stringify({ roleId })
  }).catch(() => null);
  await loadPriority();
}

async function deletePriorityOverride(discordId) {
  await api('/dashboard/priority/overrides/delete', {
    method: 'POST',
    body: JSON.stringify({ discordId })
  }).catch(() => null);
  await loadPriority();
}

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!selectedPlayer) return;

    const action = button.dataset.action;
    const actionReason = reason.value.trim();
    if (action === 'spectate') {
      actionNotice.textContent = 'website spectate starting...';
      await startWebsiteSpectate(selectedPlayer);
      actionNotice.textContent = 'website spectate active.';
      return;
    }

    if (!actionReason && action !== 'revive' && action !== 'down' && action !== 'spectate') {
      actionNotice.textContent = 'Reason is required.';
      return;
    }

    actionNotice.textContent = `${action} submitted...`;
    const response = await api(`/dashboard/moderation/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: selectedPlayer.id,
        playerName: selectedPlayer.name,
        discordId: selectedPlayer.discordId,
        license: selectedPlayer.license,
        reason: actionReason
          || (action === 'revive' ? 'Revive requested'
          : action === 'down' ? 'Marked dead by management'
          : 'Spectate requested')
      })
    }).catch(() => null);

    if (!response || !response.ok) {
      actionNotice.textContent = 'Action failed.';
      return;
    }

    const data = await response.json();
    actionNotice.textContent = action === 'revive'
      ? 'revive sent to the city.'
      : action === 'down'
      ? 'make dead sent to the city.'
      : action === 'spectate'
      ? 'spectate sent to your in-city client.'
      : data.ticket
      ? `${action} sent. Ticket #${data.ticket.name} opened.`
      : `${action} sent. Check bot permissions if no Discord ticket appeared.`;
    reason.value = '';
    await loadStatus();
  });
});

stopSpectateButton.addEventListener('click', () => {
  stopWebsiteSpectate();
});

firebaseUsersList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-save-user-role]');
  if (!button || dashboardUser?.role !== 'founder') return;

  const uid = button.dataset.saveUserRole;
  const select = firebaseUsersList.querySelector(`[data-user-role="${CSS.escape(uid)}"]`);
  const nameInput = firebaseUsersList.querySelector(`[data-user-name="${CSS.escape(uid)}"]`);
  if (!select) return;

  firebaseUsersNotice.textContent = 'Saving Firebase user...';
  button.disabled = true;
  const response = await api('/dashboard/users/role', {
    method: 'POST',
    body: JSON.stringify({ uid, role: select.value, name: nameInput ? nameInput.value : undefined })
  }).catch(() => null);
  button.disabled = false;

  if (!response || !response.ok) {
    const error = response ? await response.json().catch(() => ({})) : {};
    firebaseUsersNotice.textContent = error.error || 'Could not save Firebase role.';
    return;
  }

  firebaseUsersNotice.textContent = 'Firebase role saved. They may need to log out and back in.';
  await loadFirebaseUsers();
});

async function setupFirebaseLogin() {
  const response = await fetch('/dashboard/firebase-config').catch(() => null);
  if (!response || !response.ok) return;

  const { configured, config } = await response.json();
  if (!configured) return;

  try {
    const [
      { initializeApp },
      { getAuth, onAuthStateChanged }
    ] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')
    ]);
    const app = initializeApp(config);
    firebaseAuth = getAuth(app);

    onAuthStateChanged(firebaseAuth, async (user) => {
      if (!user || authToken) return;
      await completeFirebaseLogin(user);
    });
  } catch (error) {
    setLoginError(describeFirebaseError(error));
  }
}

setupFirebaseLogin();
setAuthState(Boolean(authToken));
