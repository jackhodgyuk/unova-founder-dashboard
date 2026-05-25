const panel = document.getElementById('panel');
const playerList = document.getElementById('players');
const ticketsPanel = document.getElementById('ticketsPanel');
const ticketsList = document.getElementById('tickets');
const empty = document.getElementById('empty');
const moderation = document.getElementById('moderation');
const reportForm = document.getElementById('reportForm');
const playerName = document.getElementById('playerName');
const playerMeta = document.getElementById('playerMeta');
const reason = document.getElementById('reason');
const notice = document.getElementById('notice');
const reportNotice = document.getElementById('reportNotice');

let players = [];
let tickets = [];
let selectedPlayer = null;

function resourceName() {
  return typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'unova_dashboard_bridge';
}

function postNui(eventName, data = {}) {
  return fetch(`https://${resourceName()}/${eventName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

function setNotice(message, ok) {
  notice.textContent = message || '';
  notice.className = ok ? 'notice ok' : 'notice error';
}

function setReportNotice(message, ok) {
  reportNotice.textContent = message || '';
  reportNotice.className = ok ? 'notice ok' : 'notice error';
}

function renderPlayers() {
  playerList.innerHTML = '';

  if (!players.length) {
    const item = document.createElement('div');
    item.className = 'section-title';
    item.textContent = 'No players online';
    playerList.appendChild(item);
    return;
  }

  for (const player of players) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `player${selectedPlayer && selectedPlayer.id === player.id ? ' active' : ''}`;
    button.innerHTML = `<strong>${player.name}</strong><small>ID ${player.id} | Discord ${player.discordId || 'not linked'}</small>`;
    button.addEventListener('click', () => selectPlayer(player));
    playerList.appendChild(button);
  }
}

function renderTickets() {
  ticketsList.innerHTML = '';
  ticketsPanel.classList.toggle('hidden', !tickets.length);
  for (const ticket of tickets) {
    const item = document.createElement('div');
    item.className = 'ticket';
    item.innerHTML = `<strong>${ticket.channelName || 'ticket'}</strong><small>${ticket.kind || 'ticket'} | ${ticket.level || 'management'}</small>`;
    ticketsList.appendChild(item);
  }
}

function selectPlayer(player) {
  selectedPlayer = player;
  playerName.textContent = player.name;
  playerMeta.textContent = `FiveM ID ${player.id} | Discord ${player.discordId || 'not linked'} | ${player.license || 'no license'}`;
  empty.classList.add('hidden');
  moderation.classList.remove('hidden');
  setNotice('', true);
  renderPlayers();
}

function openPanel(nextPlayers) {
  players = nextPlayers || [];
  tickets = [];
  if (arguments.length > 1) tickets = arguments[1] || [];
  panel.classList.remove('hidden');
  reportForm.classList.add('hidden');
  renderPlayers();
  renderTickets();
}

function openReport(nextPlayers) {
  players = nextPlayers || [];
  panel.classList.remove('hidden');
  empty.classList.add('hidden');
  moderation.classList.add('hidden');
  reportForm.classList.remove('hidden');
  renderPlayers();
}

function closePanel() {
  panel.classList.add('hidden');
  selectedPlayer = null;
  empty.classList.remove('hidden');
  moderation.classList.add('hidden');
  reportForm.classList.add('hidden');
  reason.value = '';
  reportForm.reset();
}

window.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'open') {
    openPanel(data.players, data.tickets);
  }

  if (data.type === 'openReport') {
    openReport(data.players);
  }

  if (data.type === 'players') {
    players = data.players || [];
    tickets = data.tickets || [];
    if (selectedPlayer) {
      selectedPlayer = players.find((player) => player.id === selectedPlayer.id) || null;
    }
    if (!selectedPlayer) {
      empty.classList.remove('hidden');
      moderation.classList.add('hidden');
    }
    renderPlayers();
    renderTickets();
  }

  if (data.type === 'notice') {
    setNotice(data.message, data.ok);
  }

  if (data.type === 'toast') {
    setReportNotice(`${data.title || 'Unova'}: ${data.message || ''}`, true);
  }

  if (data.type === 'close') {
    closePanel();
  }
});

reportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(reportForm);
  const payload = Object.fromEntries(formData);
  if (!payload.offenderPlayerId || !payload.bodycamUrl || !payload.description) {
    setReportNotice('All fields are required.', false);
    return;
  }
  setReportNotice('Opening golden lottery ticket...', true);
  postNui('report', payload);
});

document.getElementById('close').addEventListener('click', () => {
  postNui('close');
});

document.getElementById('refresh').addEventListener('click', () => {
  postNui('refresh');
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!selectedPlayer) return;

    const action = button.dataset.action;
    const value = reason.value.trim();
    if (!value) {
      setNotice('Reason is required.', false);
      return;
    }

    setNotice(`${action} submitted...`, true);
    postNui('moderate', {
      action,
      playerId: selectedPlayer.id,
      reason: value
    });
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    postNui('close');
  }
});
