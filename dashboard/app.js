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
const priorityView = document.getElementById('priorityView');
const settingsView = document.getElementById('settingsView');
const settingsNavButton = document.getElementById('settingsNavButton');
const founderSettingsPanel = document.getElementById('founderSettingsPanel');
const priorityRoleForm = document.getElementById('priorityRoleForm');
const priorityOverrideForm = document.getElementById('priorityOverrideForm');
const priorityRulesList = document.getElementById('priorityRulesList');
const priorityOverridesList = document.getElementById('priorityOverridesList');

let authToken = localStorage.getItem(tokenKey);
let players = [];
let selectedPlayer = null;
let refreshTimer = null;
let firebaseAuth = null;
let dashboardUser = null;

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
  return String(value || 'admin')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function roleRank(value) {
  return {
    admin: 1,
    co_owner: 2,
    owner: 3,
    founder: 4
  }[value] || 0;
}

function canManagePriority() {
  return roleRank(dashboardUser?.role) >= roleRank('owner');
}

function describeFirebaseError(error) {
  const code = error?.code || 'unknown';
  const messages = {
    'auth/invalid-email': 'Enter a valid Firebase email address.',
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
    setLoginError(error.message || 'This Firebase user needs a dashboard role in Cloud Run.');
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
      ? `${formatRole(dashboardUser.role)} Access`
      : 'Firebase Password Access';
    founderSettingsPanel.classList.toggle('hidden', dashboardUser.role !== 'founder');
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
}

function renderPriority(data) {
  const rules = data.rules || [];
  const overrides = data.overrides || [];
  const lockedMessage = canManagePriority() ? '' : '<small class="muted">Owner, co-owner, or founder required to edit.</small>';
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
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    setLoginError('Email and password are required.');
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
  const currentPassword = String(formData.get('currentPassword') || '');
  const newPassword = String(formData.get('newPassword') || '');
  passwordNotice.textContent = '';

  try {
    const {
      EmailAuthProvider,
      reauthenticateWithCredential,
      updatePassword
    } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    const credential = EmailAuthProvider.credential(firebaseAuth.currentUser.email, currentPassword);
    await reauthenticateWithCredential(firebaseAuth.currentUser, credential);
    await updatePassword(firebaseAuth.currentUser, newPassword);
    passwordForm.reset();
    passwordNotice.textContent = 'Password changed.';
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
    priorityView.classList.toggle('hidden', view !== 'priority');
    settingsView.classList.toggle('hidden', view !== 'settings');
    if (view === 'priority') loadPriority();
  });
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
    if (!actionReason) {
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
      })
    }).catch(() => null);

    if (!response || !response.ok) {
      actionNotice.textContent = 'Action failed.';
      return;
    }

    const data = await response.json();
    actionNotice.textContent = data.ticket
      ? `${action} sent. Ticket #${data.ticket.name} opened.`
      : `${action} sent. Check bot permissions if no Discord ticket appeared.`;
    reason.value = '';
    await loadStatus();
  });
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
