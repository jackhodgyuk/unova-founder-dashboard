const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const pool = require('./db');

loadEnvFile();

const dashboardDir = path.join(__dirname, '..', 'dashboard');
const discordApiBase = 'https://discord.com/api/v10';
const ticketAllow = [
  1024n, // ViewChannel
  2048n, // SendMessages
  65536n, // ReadMessageHistory
  32768n, // AttachFiles
  16384n // EmbedLinks
].reduce((value, permission) => value | permission, 0n).toString();
const ticketDenyView = '1024';

const state = {
  fivemOnlinePlayers: [],
  latestStatus: null,
  moderationQueue: [],
  recentModerationActions: []
};

const server = http.createServer((req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  handleRequest(req, res).catch((error) => {
    console.warn(`[Unova API] Request failed: ${error.message}`);
    sendJson(res, 500, { error: 'Internal server error.' });
  });
});

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  }[extension] || 'application/octet-stream';
}

function sendFile(res, filePath) {
  const resolvedFile = path.resolve(filePath);
  const resolvedDashboard = path.resolve(dashboardDir);
  const relativePath = path.relative(resolvedDashboard, resolvedFile);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(resolvedFile, (error, data) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(resolvedFile) });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signFounderToken() {
  const secret = process.env.DASHBOARD_JWT_SECRET;
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    discordId: process.env.FOUNDER_DISCORD_ID,
    role: 'Founder',
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60)
  });
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyFounderToken(token) {
  const secret = process.env.DASHBOARD_JWT_SECRET;
  if (!secret || !token) throw new Error('Missing token.');

  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw new Error('Malformed token.');

  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error('Bad token signature.');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token.');
  }

  return decoded;
}

function requireFounder(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    const decoded = verifyFounderToken(token);
    if (decoded.discordId !== process.env.FOUNDER_DISCORD_ID) {
      sendJson(res, 403, { error: 'Founder access required.' });
      return null;
    }
    return decoded;
  } catch {
    sendJson(res, 401, { error: 'Invalid or missing dashboard token.' });
    return null;
  }
}

function requireFiveM(req, res) {
  if (req.headers['x-api-key'] !== process.env.FIVEM_API_KEY) {
    sendJson(res, 401, { error: 'Invalid FiveM API key.' });
    return false;
  }
  return true;
}

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

async function postDiscord(token, route, body) {
  const response = await fetch(`${discordApiBase}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `Discord API returned ${response.status}`);
    error.response = { data, status: response.status };
    throw error;
  }

  return data;
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
    type: 0,
    topic: `unova-founder-ticket | source=${moderationAction.source} | action=${moderationAction.action} | id=${moderationAction.id}`,
    permission_overwrites: buildTicketOverwrites(targetDiscordId ? [targetDiscordId] : [])
  };

  const categoryId = cleanId(process.env.DISCORD_TICKET_CATEGORY_ID || process.env.TICKET_CATEGORY_ID);
  if (categoryId) body.parent_id = categoryId;

  try {
    const channel = await postDiscord(token, `/guilds/${guildId}/channels`, body);
    const founderRoleId = cleanId(process.env.FOUNDER_ROLE_ID);
    const founderDiscordId = cleanId(process.env.FOUNDER_DISCORD_ID);
    const founderLine = founderRoleId ? `Founder role: <@&${founderRoleId}>` : `Founder: <@${founderDiscordId}>`;
    const targetLine = targetDiscordId
      ? `Target Discord: <@${targetDiscordId}> (${targetDiscordId})`
      : 'Target Discord: not linked/provided';

    await postDiscord(token, `/channels/${channel.id}/messages`, {
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
  return { status: 200, payload: { ok: true, moderationAction, ticket } };
}

function getMemoryStatus() {
  return normalizeStatus(state.latestStatus);
}

async function getPersistedStatus() {
  const [rows] = await safeQuery('SELECT * FROM server_status WHERE id = 1');
  return normalizeStatus(rows[0] || state.latestStatus);
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/healthz')) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    redirect(res, '/dashboard/');
    return;
  }

  if (req.method === 'GET' && (pathname === '/dashboard' || pathname === '/dashboard/')) {
    sendFile(res, path.join(dashboardDir, 'index.html'));
    return;
  }

  if (req.method === 'POST' && pathname === '/auth/founder-dev-login') {
    const body = await readBody(req);
    if (body.founderKey !== process.env.DASHBOARD_JWT_SECRET) {
      sendJson(res, 401, { error: 'Bad founder key.' });
      return;
    }
    sendJson(res, 200, { token: signFounderToken() });
    return;
  }

  if (req.method === 'POST' && pathname === '/fivem/update') {
    if (!requireFiveM(req, res)) return;

    const status = await readBody(req);
    state.latestStatus = {
      ...status,
      updatedAt: status.updatedAt || new Date().toISOString()
    };
    state.fivemOnlinePlayers = status.players || [];
    await safeQuery(
      `INSERT INTO server_status (id, server_name, online_players, max_players, players_json)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE server_name=VALUES(server_name), online_players=VALUES(online_players), max_players=VALUES(max_players), players_json=VALUES(players_json)`,
      [status.serverName, status.onlinePlayers, status.maxPlayers, JSON.stringify(status.players || [])]
    );
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/players') {
    const fivem = getMemoryStatus();
    sendJson(res, 200, {
      fivem,
      players: fivem.players || []
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/internal/fivem/online-discord-ids') {
    if (!requireFiveM(req, res)) return;

    const discordIds = state.fivemOnlinePlayers
      .map((player) => cleanId(player.discordId))
      .filter(Boolean);
    sendJson(res, 200, { discordIds });
    return;
  }

  if (req.method === 'GET' && pathname === '/dashboard/status') {
    if (!requireFounder(req, res)) return;

    const fivem = await getPersistedStatus();
    sendJson(res, 200, {
      fivem,
      players: fivem.players || [],
      queueLength: state.moderationQueue.length,
      recentActions: state.recentModerationActions
    });
    return;
  }

  const dashboardModerationMatch = pathname.match(/^\/dashboard\/moderation\/([^/]+)$/);
  if (req.method === 'POST' && dashboardModerationMatch) {
    const user = requireFounder(req, res);
    if (!user) return;

    const result = await recordModerationAction(
      dashboardModerationMatch[1],
      await readBody(req),
      user.discordId,
      'dashboard'
    );
    sendJson(res, result.status, result.payload);
    return;
  }

  const fivemModerationMatch = pathname.match(/^\/fivem\/founder\/moderation\/([^/]+)$/);
  if (req.method === 'POST' && fivemModerationMatch) {
    if (!requireFiveM(req, res)) return;

    const body = await readBody(req);
    if (cleanId(body.moderatorDiscordId) !== cleanId(process.env.FOUNDER_DISCORD_ID)) {
      sendJson(res, 403, { error: 'Founder access required.' });
      return;
    }

    const result = await recordModerationAction(
      fivemModerationMatch[1],
      body,
      cleanId(body.moderatorDiscordId),
      'fivem-ui'
    );
    sendJson(res, result.status, result.payload);
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/moderation/poll') {
    if (!requireFiveM(req, res)) return;

    const actions = state.moderationQueue.splice(0, 25);
    sendJson(res, 200, { actions });
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/bans/check') {
    if (!requireFiveM(req, res)) return;

    const license = requestUrl.searchParams.get('license');
    const [rows] = await safeQuery('SELECT * FROM fivem_bans WHERE license = ? AND active = 1 LIMIT 1', [license]);
    sendJson(res, 200, { banned: rows.length > 0, ban: rows[0] || null });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/dashboard/')) {
    const relativePath = decodeURIComponent(pathname.slice('/dashboard/'.length));
    sendFile(res, path.join(dashboardDir, relativePath));
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
}

function startServer(onListening) {
  const port = Number(process.env.PORT) || 8080;
  const host = '0.0.0.0';
  return server.listen(port, host, () => {
    console.log(`[Unova API] Running on http://${host}:${port}`);
    if (typeof onListening === 'function') {
      onListening();
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, startServer };
