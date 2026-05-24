require('dotenv').config();

const axios = require('axios');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const http = require('http');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { Server } = require('socket.io');
const pool = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const state = {
  fivemOnlinePlayers: [],
  latestStatus: null,
  moderationQueue: [],
  recentModerationActions: []
};

const discordApiBase = 'https://discord.com/api/v10';
const ticketAllow = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks
].reduce((value, permission) => value | permission, 0n).toString();
const ticketDenyView = PermissionFlagsBits.ViewChannel.toString();

function cleanId(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return /^\d{15,25}$/.test(trimmed) ? trimmed : null;
}

function cleanAction(value) {
  return ['warn', 'kick', 'ban'].includes(value) ? value : null;
}

function normalizeStatus(rowOrStatus) {
  if (!rowOrStatus) {
    return {
      serverName: 'Unova',
      onlinePlayers: 0,
      maxPlayers: 0,
      players: state.fivemOnlinePlayers,
      updatedAt: null
    };
  }

  if (Array.isArray(rowOrStatus.players)) {
    return rowOrStatus;
  }

  let players = [];
  if (rowOrStatus.players_json) {
    try {
      players = typeof rowOrStatus.players_json === 'string'
        ? JSON.parse(rowOrStatus.players_json)
        : rowOrStatus.players_json;
    } catch {
      players = [];
    }
  }

  return {
    serverName: rowOrStatus.server_name || rowOrStatus.serverName || 'Unova',
    onlinePlayers: rowOrStatus.online_players || rowOrStatus.onlinePlayers || players.length,
    maxPlayers: rowOrStatus.max_players || rowOrStatus.maxPlayers || 0,
    players,
    updatedAt: rowOrStatus.updated_at || rowOrStatus.updatedAt || null
  };
}

function sanitizeChannelName(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function safeQuery(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch (error) {
    console.warn(`[Unova API] Database query skipped: ${error.message}`);
    return [[]];
  }
}

function requireFounder(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.DASHBOARD_JWT_SECRET);
    if (decoded.discordId !== process.env.FOUNDER_DISCORD_ID) {
      return res.status(403).json({ error: 'Founder access required.' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or missing dashboard token.' });
  }
}

function requireFiveM(req, res, next) {
  if (req.headers['x-api-key'] !== process.env.FIVEM_API_KEY) {
    return res.status(401).json({ error: 'Invalid FiveM API key.' });
  }
  next();
}

function buildTicketOverwrites(extraUserIds = []) {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const founderRoleId = cleanId(process.env.FOUNDER_ROLE_ID);
  const founderDiscordId = cleanId(process.env.FOUNDER_DISCORD_ID);
  const botRoleId = cleanId(process.env.DISCORD_BOT_ROLE_ID);
  const botUserId = cleanId(process.env.DISCORD_BOT_USER_ID);
  const overwrites = [];
  const seen = new Set();

  function addOverwrite(id, type, allow, deny) {
    if (!id || seen.has(`${type}:${id}`)) return;
    seen.add(`${type}:${id}`);
    const overwrite = { id, type };
    if (allow) overwrite.allow = allow;
    if (deny) overwrite.deny = deny;
    overwrites.push(overwrite);
  }

  addOverwrite(guildId, 0, null, ticketDenyView);
  addOverwrite(founderRoleId, 0, ticketAllow, null);
  addOverwrite(founderDiscordId, 1, ticketAllow, null);
  addOverwrite(botRoleId, 0, ticketAllow, null);
  addOverwrite(botUserId, 1, ticketAllow, null);

  for (const userId of extraUserIds.map(cleanId).filter(Boolean)) {
    addOverwrite(userId, 1, ticketAllow, null);
  }

  return overwrites;
}

async function createDiscordModerationTicket(moderationAction) {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!guildId || !token) {
    console.warn('[Unova API] Discord ticket skipped: missing guild ID or bot token.');
    return null;
  }

  const targetDiscordId = cleanId(moderationAction.discordId);
  const targetSuffix = targetDiscordId || moderationAction.playerId || moderationAction.license || moderationAction.id;
  const channelName = sanitizeChannelName(`mod-${moderationAction.action}-${targetSuffix}`);
  const body = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `unova-founder-ticket | source=${moderationAction.source} | action=${moderationAction.action} | id=${moderationAction.id}`,
    permission_overwrites: buildTicketOverwrites(targetDiscordId ? [targetDiscordId] : [])
  };

  const categoryId = cleanId(process.env.DISCORD_TICKET_CATEGORY_ID || process.env.TICKET_CATEGORY_ID);
  if (categoryId) body.parent_id = categoryId;

  try {
    const channelResponse = await axios.post(`${discordApiBase}/guilds/${guildId}/channels`, body, {
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const channel = channelResponse.data;
    const founderRoleId = cleanId(process.env.FOUNDER_ROLE_ID);
    const founderDiscordId = cleanId(process.env.FOUNDER_DISCORD_ID);
    const founderLine = founderRoleId ? `Founder role: <@&${founderRoleId}>` : `Founder: <@${founderDiscordId}>`;
    const targetLine = targetDiscordId
      ? `Target Discord: <@${targetDiscordId}> (${targetDiscordId})`
      : 'Target Discord: not linked/provided';

    await axios.post(`${discordApiBase}/channels/${channel.id}/messages`, {
      content: [
        '**FiveM moderation ticket opened**',
        founderLine,
        `Action: ${moderationAction.action.toUpperCase()}`,
        `Reason: ${moderationAction.reason}`,
        targetLine,
        `FiveM player ID: ${moderationAction.playerId || 'unknown'}`,
        `FiveM name: ${moderationAction.playerName || 'unknown'}`,
        `License: ${moderationAction.license || 'unknown'}`,
        `Moderator: <@${moderationAction.moderatorDiscordId}>`,
        '',
        'Only founder access, bot access, and explicitly added users can see this ticket.'
      ].join('\n'),
      allowed_mentions: {
        parse: ['roles', 'users']
      }
    }, {
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    return { id: channel.id, name: channel.name };
  } catch (error) {
    console.warn(`[Unova API] Discord ticket creation failed: ${error.response?.data?.message || error.message}`);
    return null;
  }
}

async function recordModerationAction(action, body, moderatorDiscordId, source) {
  const cleanModerationAction = cleanAction(action);
  if (!cleanModerationAction) {
    return { status: 400, payload: { error: 'Invalid action.' } };
  }

  const reason = String(body.reason || '').trim();
  if (!reason) {
    return { status: 400, payload: { error: 'Reason is required.' } };
  }

  const moderationAction = {
    id: Date.now().toString(),
    action: cleanModerationAction,
    discordId: cleanId(body.discordId),
    citizenid: body.citizenid || null,
    license: body.license || null,
    playerId: body.playerId || null,
    playerName: body.playerName || null,
    reason,
    moderatorDiscordId,
    source,
    createdAt: new Date().toISOString()
  };

  state.moderationQueue.push(moderationAction);
  state.recentModerationActions.unshift(moderationAction);
  state.recentModerationActions = state.recentModerationActions.slice(0, 50);

  await safeQuery(
    'INSERT INTO punishments (action, discord_id, citizenid, license, reason, moderator_discord_id) VALUES (?, ?, ?, ?, ?, ?)',
    [
      moderationAction.action,
      moderationAction.discordId,
      moderationAction.citizenid,
      moderationAction.license,
      moderationAction.reason,
      moderationAction.moderatorDiscordId
    ]
  );

  if (moderationAction.action === 'ban') {
    await safeQuery(
      'INSERT INTO fivem_bans (license, discord_id, citizenid, reason, moderator_discord_id) VALUES (?, ?, ?, ?, ?)',
      [
        moderationAction.license || 'unknown',
        moderationAction.discordId,
        moderationAction.citizenid,
        moderationAction.reason,
        moderationAction.moderatorDiscordId
      ]
    );
  }

  const ticket = await createDiscordModerationTicket(moderationAction);
  io.emit('moderation:new', moderationAction);

  return { status: 200, payload: { ok: true, moderationAction, ticket } };
}

// TEMP founder login. Replace with Discord OAuth2 before production.
app.post('/auth/founder-dev-login', (req, res) => {
  const { founderKey } = req.body;
  if (founderKey !== process.env.DASHBOARD_JWT_SECRET) {
    return res.status(401).json({ error: 'Bad founder key.' });
  }
  const token = jwt.sign(
    { discordId: process.env.FOUNDER_DISCORD_ID, role: 'Founder' },
    process.env.DASHBOARD_JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token });
});

app.post('/fivem/update', requireFiveM, async (req, res) => {
  const status = req.body;
  state.latestStatus = status;
  state.fivemOnlinePlayers = status.players || [];
  await safeQuery(
    `INSERT INTO server_status (id, server_name, online_players, max_players, players_json)
     VALUES (1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE server_name=VALUES(server_name), online_players=VALUES(online_players), max_players=VALUES(max_players), players_json=VALUES(players_json)`,
    [status.serverName, status.onlinePlayers, status.maxPlayers, JSON.stringify(status.players || [])]
  );
  io.emit('fivem:update', status);
  res.json({ ok: true });
});

app.get('/internal/fivem/online-discord-ids', requireFiveM, (req, res) => {
  const discordIds = state.fivemOnlinePlayers
    .map((player) => cleanId(player.discordId))
    .filter(Boolean);
  res.json({ discordIds });
});

app.get('/dashboard/status', requireFounder, async (req, res) => {
  const [rows] = await safeQuery('SELECT * FROM server_status WHERE id = 1');
  const fivem = normalizeStatus(rows[0] || state.latestStatus);
  res.json({
    fivem,
    players: fivem.players || [],
    queueLength: state.moderationQueue.length,
    recentActions: state.recentModerationActions
  });
});

app.post('/dashboard/moderation/:action', requireFounder, async (req, res) => {
  const result = await recordModerationAction(req.params.action, req.body, req.user.discordId, 'dashboard');
  res.status(result.status).json(result.payload);
});

app.post('/fivem/founder/moderation/:action', requireFiveM, async (req, res) => {
  if (cleanId(req.body.moderatorDiscordId) !== cleanId(process.env.FOUNDER_DISCORD_ID)) {
    return res.status(403).json({ error: 'Founder access required.' });
  }

  const result = await recordModerationAction(
    req.params.action,
    req.body,
    cleanId(req.body.moderatorDiscordId),
    'fivem-ui'
  );
  res.status(result.status).json(result.payload);
});

app.get('/fivem/moderation/poll', requireFiveM, (req, res) => {
  const actions = state.moderationQueue.splice(0, 25);
  res.json({ actions });
});

app.get('/fivem/bans/check', requireFiveM, async (req, res) => {
  const { license } = req.query;
  const [rows] = await safeQuery('SELECT * FROM fivem_bans WHERE license = ? AND active = 1 LIMIT 1', [license]);
  res.json({ banned: rows.length > 0, ban: rows[0] || null });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.redirect('/dashboard/');
});

app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

function startServer() {
  const port = process.env.PORT || 3001;
  return server.listen(port, () => {
    console.log(`[Unova API] Running on port ${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
