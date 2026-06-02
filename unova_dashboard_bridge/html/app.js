const panel = document.getElementById('panel');
const playerList = document.getElementById('players');
const ticketsPanel = document.getElementById('ticketsPanel');
const ticketsList = document.getElementById('tickets');
const empty = document.getElementById('empty');
const moderation = document.getElementById('moderation');
const reportForm = document.getElementById('reportForm');
const ticketReader = document.getElementById('ticketReader');
const ticketTitle = document.getElementById('ticketTitle');
const ticketMeta = document.getElementById('ticketMeta');
const ticketMessages = document.getElementById('ticketMessages');
const ticketReplyForm = document.getElementById('ticketReplyForm');
const ticketReply = document.getElementById('ticketReply');
const ticketNotice = document.getElementById('ticketNotice');
const playerName = document.getElementById('playerName');
const playerMeta = document.getElementById('playerMeta');
const reason = document.getElementById('reason');
const notice = document.getElementById('notice');
const reportNotice = document.getElementById('reportNotice');
const toastStack = document.getElementById('toastStack');

let players = [];
let tickets = [];
let selectedPlayer = null;
let selectedTicket = null;

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

function setTicketNotice(message, ok) {
  ticketNotice.textContent = message || '';
  ticketNotice.className = ok ? 'notice ok' : 'notice error';
}

function showToast(title, message, ok = true) {
  if (!toastStack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${ok ? 'ok' : 'error'}`;
  toast.innerHTML = `<strong>${title || 'Unova'}</strong><span>${message || ''}</span>`;
  toastStack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('closing');
    setTimeout(() => toast.remove(), 450);
  }, 8500);
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
    item.className = `ticket${selectedTicket && selectedTicket.channelId === ticket.channelId ? ' active' : ''}`;
    item.innerHTML = [
      `<strong>${ticket.channelName || 'ticket'}</strong>`,
      `<small>${ticket.kind || 'ticket'} | ${ticket.level || 'management'}</small>`,
      '<button type="button">Open</button>'
    ].join('');
    item.querySelector('button').addEventListener('click', () => openTicket(ticket));
    ticketsList.appendChild(item);
  }
}

function renderTicketMessages(messages, canSend) {
  ticketMessages.innerHTML = '';
  if (!messages.length) {
    ticketMessages.innerHTML = '<div class="ticket-message muted">No messages found.</div>';
  }

  for (const message of messages) {
    const item = document.createElement('div');
    item.className = `ticket-message${message.bot ? ' bot' : ''}`;
    const attachments = (message.attachments || []).map((attachment) => (
      `<a href="${escapeHtml(attachment.url)}" target="_blank">${escapeHtml(attachment.name || 'attachment')}</a>`
    )).join('');
    item.innerHTML = [
      `<strong>${message.authorName || 'Unknown'} <small>${message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</small></strong>`,
      `<p>${escapeHtml(message.content || '')}</p>`,
      attachments ? `<div class="attachments">${attachments}</div>` : ''
    ].join('');
    ticketMessages.appendChild(item);
  }
  ticketMessages.scrollTop = ticketMessages.scrollHeight;
  ticketReply.disabled = !canSend;
  ticketReplyForm.querySelector('button').disabled = !canSend;
  ticketReply.placeholder = canSend ? 'Reply to this Discord ticket from city' : 'Read-only: Discord permissions do not allow replies';
}

function openTicket(ticket) {
  selectedTicket = ticket;
  selectedPlayer = null;
  empty.classList.add('hidden');
  moderation.classList.add('hidden');
  reportForm.classList.add('hidden');
  ticketReader.classList.remove('hidden');
  ticketTitle.textContent = ticket.channelName || 'Ticket';
  ticketMeta.textContent = `${ticket.kind || 'ticket'} | ${ticket.level || 'management'} | ${ticket.targetName || ticket.openerName || 'Discord'}`;
  setTicketNotice('Loading ticket messages...', true);
  renderTickets();
  postNui('openTicket', { channelId: ticket.channelId });
}

function selectPlayer(player) {
  selectedPlayer = player;
  selectedTicket = null;
  playerName.textContent = player.name;
  playerMeta.textContent = `FiveM ID ${player.id} | Discord ${player.discordId || 'not linked'} | ${player.license || 'no license'}`;
  empty.classList.add('hidden');
  moderation.classList.remove('hidden');
  ticketReader.classList.add('hidden');
  setNotice('', true);
  renderPlayers();
  renderTickets();
}

function openPanel(nextPlayers) {
  players = nextPlayers || [];
  tickets = [];
  if (arguments.length > 1) tickets = arguments[1] || [];
  panel.classList.remove('hidden');
  reportForm.classList.add('hidden');
  ticketReader.classList.add('hidden');
  renderPlayers();
  renderTickets();
}

function openReport(nextPlayers) {
  players = nextPlayers || [];
  panel.classList.remove('hidden');
  empty.classList.add('hidden');
  moderation.classList.add('hidden');
  ticketReader.classList.add('hidden');
  reportForm.classList.remove('hidden');
  renderPlayers();
}

function closePanel() {
  panel.classList.add('hidden');
  selectedPlayer = null;
  selectedTicket = null;
  empty.classList.remove('hidden');
  moderation.classList.add('hidden');
  ticketReader.classList.add('hidden');
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
    if (!selectedPlayer && !selectedTicket) {
      empty.classList.remove('hidden');
      moderation.classList.add('hidden');
    }
    renderPlayers();
    renderTickets();
  }

  if (data.type === 'notice') {
    setNotice(data.message, data.ok);
    setTicketNotice(data.message, data.ok);
  }

  if (data.type === 'toast') {
    showToast(data.title || 'Unova', data.message || '', true);
    setReportNotice(`${data.title || 'Unova'}: ${data.message || ''}`, true);
  }

  if (data.type === 'close') {
    closePanel();
  }

  if (data.type === 'ticketMessages') {
    selectedTicket = data.ticket || selectedTicket;
    if (selectedTicket) {
      ticketTitle.textContent = selectedTicket.channelName || 'Ticket';
      ticketMeta.textContent = `${selectedTicket.kind || 'ticket'} | ${selectedTicket.level || 'management'} | ${selectedTicket.targetName || selectedTicket.openerName || 'Discord'}`;
    }
    ticketReader.classList.remove('hidden');
    empty.classList.add('hidden');
    moderation.classList.add('hidden');
    reportForm.classList.add('hidden');
    renderTicketMessages(data.messages || [], data.canSend === true);
    setTicketNotice(data.canSend ? 'Ticket loaded. You can reply from city.' : 'Ticket loaded as read-only.', data.canSend === true);
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

ticketReplyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!selectedTicket) return;
  const message = ticketReply.value.trim();
  if (!message) {
    setTicketNotice('Message is required.', false);
    return;
  }
  setTicketNotice('Sending reply...', true);
  postNui('replyTicket', {
    channelId: selectedTicket.channelId,
    message
  });
  ticketReply.value = '';
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
    if (!value && action !== 'revive' && action !== 'down' && action !== 'spectate') {
      setNotice('Reason is required.', false);
      return;
    }

    setNotice(`${action} submitted...`, true);
    postNui('moderate', {
      action,
      playerId: selectedPlayer.id,
      reason: value
        || (action === 'revive' ? 'Revive requested'
        : action === 'down' ? 'Marked dead by management'
        : 'Spectate requested')
    });
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    postNui('close');
  }
});

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}
