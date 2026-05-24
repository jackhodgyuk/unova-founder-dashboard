const tokenKey = 'unovaFounderToken';
const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
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

let authToken = localStorage.getItem(tokenKey);
let players = [];
let selectedPlayer = null;
let refreshTimer = null;

function setAuthState(isAuthed) {
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

function api(path, options = {}) {
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
    item.innerHTML = [
      `<span class="badge ${action.action}">${action.action}</span>`,
      `<span>${escapeHtml(action.playerName || action.discordId || action.license || 'Unknown target')} - ${escapeHtml(action.reason || '')}</span>`,
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
  loginError.textContent = '';
  const founderKey = new FormData(loginForm).get('founderKey');

  const response = await fetch('/auth/founder-dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ founderKey })
  }).catch(() => null);

  if (!response || !response.ok) {
    loginError.textContent = 'Founder key rejected.';
    return;
  }

  const data = await response.json();
  authToken = data.token;
  localStorage.setItem(tokenKey, authToken);
  loginForm.reset();
  setAuthState(true);
});

document.getElementById('logoutButton').addEventListener('click', () => {
  localStorage.removeItem(tokenKey);
  authToken = null;
  setAuthState(false);
});

document.getElementById('refreshButton').addEventListener('click', loadStatus);

document.querySelectorAll('.nav button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const view = button.dataset.view;
    playersView.classList.toggle('hidden', view !== 'players');
    actionsView.classList.toggle('hidden', view !== 'actions');
  });
});

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

setAuthState(Boolean(authToken));
