const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const pool = require('./db');

loadEnvFile();

const dashboardDir = path.join(__dirname, '..', 'dashboard');
const discordApiBase = 'https://discord.com/api/v10';
const firebaseCertUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const firebasePublicConfigFallback = {
  apiKey: 'AIzaSyBgcox8irACE8ySar4SvJonHprsm9wXAJE',
  authDomain: 'founderbot-62940.firebaseapp.com',
  projectId: 'founderbot-62940',
  storageBucket: 'founderbot-62940.firebasestorage.app',
  messagingSenderId: '287993043908',
  appId: '1:287993043908:web:71d6303aa438e4a2362291',
  measurementId: 'G-196R8VL78F'
};
const dashboardRoleRank = {
  admin: 1,
  co_owner: 2,
  owner: 3,
  founder: 4
};
const firebaseReservedClaims = new Set([
  'iss',
  'aud',
  'auth_time',
  'user_id',
  'sub',
  'iat',
  'exp',
  'email',
  'email_verified',
  'firebase',
  'name',
  'picture',
  'sign_in_provider'
]);
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
  recentModerationActions: [],
  priorityRules: [],
  priorityOverrides: [],
  firebaseCerts: null,
  firebaseCertsExpiresAt: 0
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

function decodeBase64urlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function getFirebasePublicConfig() {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || firebasePublicConfigFallback.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || firebasePublicConfigFallback.authDomain,
    projectId: process.env.FIREBASE_PROJECT_ID || firebasePublicConfigFallback.projectId,
    appId: process.env.FIREBASE_APP_ID || firebasePublicConfigFallback.appId,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || firebasePublicConfigFallback.messagingSenderId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || firebasePublicConfigFallback.storageBucket,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || firebasePublicConfigFallback.measurementId
  };

  Object.keys(config).forEach((key) => {
    if (!config[key]) delete config[key];
  });

  const configured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
  return { configured, config: configured ? config : null };
}

function normalizeDashboardRole(value) {
  const role = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (role === 'coowner' || role === 'co_owner') return 'co_owner';
  if (dashboardRoleRank[role]) return role;
  return null;
}

function appendDashboardRole(roles, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => appendDashboardRole(roles, item));
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, enabled]) => {
      if (enabled) appendDashboardRole(roles, key);
    });
    return;
  }

  const role = normalizeDashboardRole(value);
  if (role) roles.add(role);
}

function getDashboardRolesFromClaims(claims = {}) {
  const roles = new Set();
  appendDashboardRole(roles, claims.unovaRole);
  appendDashboardRole(roles, claims.dashboardRole);
  appendDashboardRole(roles, claims.role);
  appendDashboardRole(roles, claims.roles);
  appendDashboardRole(roles, claims.unovaRoles);

  for (const role of Object.keys(dashboardRoleRank)) {
    if (claims[role] === true) roles.add(role);
  }

  if (claims.coOwner === true || claims.co_owner === true) roles.add('co_owner');
  if (claims.management === true || claims.unovaManagement === true) roles.add('admin');
  return [...roles].sort((a, b) => dashboardRoleRank[b] - dashboardRoleRank[a]);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function splitEmailConfig(...values) {
  return values
    .flatMap((value) => String(value || '').split(','))
    .map(normalizeEmail)
    .filter(Boolean);
}

function emailMatchesConfig(email, ...values) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  return splitEmailConfig(...values).includes(normalizedEmail);
}

function getDashboardRolesFromEmail(email) {
  const roles = new Set();

  if (emailMatchesConfig(email, process.env.DASHBOARD_FOUNDER_EMAILS, process.env.FOUNDER_FIREBASE_EMAIL)) {
    roles.add('founder');
  }
  if (emailMatchesConfig(email, process.env.DASHBOARD_OWNER_EMAILS)) {
    roles.add('owner');
  }
  if (emailMatchesConfig(email, process.env.DASHBOARD_CO_OWNER_EMAILS, process.env.DASHBOARD_COOWNER_EMAILS)) {
    roles.add('co_owner');
  }
  if (emailMatchesConfig(email, process.env.DASHBOARD_ADMIN_EMAILS, process.env.ADMIN_FIREBASE_EMAILS)) {
    roles.add('admin');
  }

  return [...roles].sort((a, b) => dashboardRoleRank[b] - dashboardRoleRank[a]);
}

function mergeDashboardRoles(...roleLists) {
  const roles = new Set();
  for (const roleList of roleLists) {
    for (const role of roleList || []) {
      if (dashboardRoleRank[role]) roles.add(role);
    }
  }
  return [...roles].sort((a, b) => dashboardRoleRank[b] - dashboardRoleRank[a]);
}

function getPrimaryDashboardRole(roles) {
  return [...(roles || [])].sort((a, b) => dashboardRoleRank[b] - dashboardRoleRank[a])[0] || null;
}

function extractCustomClaims(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !firebaseReservedClaims.has(key))
  );
}

function getClaimDiscordId(claims) {
  return cleanId(
    claims.discordId
      || claims.discord_id
      || claims.unovaDiscordId
      || claims.unova_discord_id
  );
}

function hasDashboardAccess(user) {
  return Boolean(user && user.roles && user.roles.length);
}

function hasDashboardRoleAtLeast(user, minimumRole) {
  const minimumRank = dashboardRoleRank[minimumRole] || 999;
  const userRank = dashboardRoleRank[user?.role] || 0;
  return userRank >= minimumRank;
}

function requireDashboardRole(user, res, minimumRole) {
  if (hasDashboardRoleAtLeast(user, minimumRole)) return true;
  sendJson(res, 403, { error: `${minimumRole} dashboard role required.` });
  return false;
}

function publicDashboardUser(user) {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    picture: user.picture,
    discordId: user.discordId,
    roles: user.roles,
    role: user.role
  };
}

async function fetchFirebaseCerts() {
  if (state.firebaseCerts && Date.now() < state.firebaseCertsExpiresAt) {
    return state.firebaseCerts;
  }

  const response = await fetch(firebaseCertUrl, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Firebase cert fetch failed with ${response.status}`);

  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  state.firebaseCerts = await response.json();
  state.firebaseCertsExpiresAt = Date.now() + (maxAge * 1000);
  return state.firebaseCerts;
}

async function verifyFirebaseIdToken(idToken) {
  const projectId = process.env.FIREBASE_PROJECT_ID || firebasePublicConfigFallback.projectId;
  if (!projectId) throw new Error('Firebase project is not configured.');

  const [encodedHeader, encodedPayload, encodedSignature] = String(idToken || '').split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Malformed Firebase token.');

  const header = decodeBase64urlJson(encodedHeader);
  const payload = decodeBase64urlJson(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Firebase token.');
  if (payload.aud !== projectId) throw new Error('Firebase token audience mismatch.');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Firebase token issuer mismatch.');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || payload.exp < now || payload.iat > now + 60) {
    throw new Error('Firebase token is expired or invalid.');
  }

  const certs = await fetchFirebaseCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error('Firebase signing cert not found.');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const valid = verifier.verify(cert, Buffer.from(encodedSignature, 'base64url'));
  if (!valid) throw new Error('Firebase token signature mismatch.');

  const claims = extractCustomClaims(payload);
  const roles = mergeDashboardRoles(
    getDashboardRolesFromClaims(claims),
    getDashboardRolesFromEmail(payload.email)
  );
  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || null,
    emailVerified: payload.email_verified === true,
    name: payload.name || null,
    picture: payload.picture || null,
    discordId: getClaimDiscordId(claims),
    claims,
    roles,
    role: getPrimaryDashboardRole(roles)
  };
}

async function requireDashboardUser(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try {
    const user = await verifyFirebaseIdToken(token);
    if (!hasDashboardAccess(user)) {
      sendJson(res, 403, {
        error: 'Firebase dashboard role required.',
        message: 'Add this email to DASHBOARD_FOUNDER_EMAILS, DASHBOARD_OWNER_EMAILS, DASHBOARD_CO_OWNER_EMAILS, or DASHBOARD_ADMIN_EMAILS in Cloud Run.',
        email: user.email,
        requiredRoles: ['founder', 'owner', 'co_owner', 'admin']
      });
      return null;
    }
    return user;
  } catch (error) {
    console.warn(`[Unova API] Dashboard token rejected: ${error.message}`);
    sendJson(res, 401, { error: 'Invalid or missing Firebase token.' });
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

function splitConfig(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanIdList(...values) {
  return [...new Set(values.flatMap((value) => splitConfig(value).map(cleanId).filter(Boolean)))];
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function hasAnyRole(memberRoleIds, allowedRoleIds) {
  const memberRoles = new Set(memberRoleIds || []);
  return allowedRoleIds.some((roleId) => memberRoles.has(roleId));
}

function getManagementRoleIds() {
  return cleanIdList(
    process.env.MANAGEMENT_ROLE_ID,
    process.env.MANAGEMENT_ROLE_IDS,
    process.env.DISCORD_MANAGEMENT_ROLE_ID
  );
}

function getTicketAccessRoleIds() {
  return cleanIdList(
    process.env.MANAGEMENT_ROLE_ID,
    process.env.MANAGEMENT_ROLE_IDS,
    process.env.TICKET_ACCESS_ROLE_IDS
  );
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

function getTicketCategoryName() {
  return process.env.DISCORD_TICKET_CATEGORY_NAME || process.env.TICKET_CATEGORY_NAME || 'tickets';
}

function buildTicketOverwrites(extraUserIds = []) {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
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
  for (const roleId of getTicketAccessRoleIds()) {
    addOverwrite(roleId, 0, ticketAllow, null);
  }
  addOverwrite(botRoleId, 0, ticketAllow, null);
  addOverwrite(botUserId, 1, ticketAllow, null);

  for (const userId of extraUserIds.map(cleanId).filter(Boolean)) {
    addOverwrite(userId, 1, ticketAllow, null);
  }

  return overwrites;
}

async function discordRequest(method, token, route, body) {
  const response = await fetch(`${discordApiBase}${route}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function getDiscord(token, route) {
  return discordRequest('GET', token, route);
}

async function postDiscord(token, route, body) {
  return discordRequest('POST', token, route, body);
}

async function patchDiscord(token, route, body) {
  return discordRequest('PATCH', token, route, body);
}

async function fetchDiscordRoles(token, guildId) {
  return getDiscord(token, `/guilds/${guildId}/roles`);
}

function roleIdsFromNames(roles, names) {
  const wanted = new Set(splitConfig(names).map(normalizeName));
  if (!wanted.size) return [];

  return roles
    .filter((role) => wanted.has(normalizeName(role.name)))
    .map((role) => cleanId(role.id))
    .filter(Boolean);
}

async function resolveConfiguredRoleIds(token, guildId, idValues = [], nameValues = []) {
  const roleIds = cleanIdList(...idValues);
  const names = nameValues.flatMap(splitConfig);
  if (!names.length) return roleIds;

  try {
    const roles = await fetchDiscordRoles(token, guildId);
    return [...new Set([...roleIds, ...roleIdsFromNames(roles, names.join(','))])];
  } catch (error) {
    console.warn(`[Unova API] Discord role lookup failed: ${error.response?.data?.message || error.message}`);
    return roleIds;
  }
}

async function resolveTicketCategoryId(token, guildId) {
  const configuredCategoryId = cleanId(process.env.DISCORD_TICKET_CATEGORY_ID || process.env.TICKET_CATEGORY_ID);
  if (configuredCategoryId) return configuredCategoryId;

  const categoryName = getTicketCategoryName();
  const channels = await getDiscord(token, `/guilds/${guildId}/channels`);
  const existing = channels.find((channel) =>
    channel.type === 4 && normalizeName(channel.name) === normalizeName(categoryName)
  );
  if (existing) return existing.id;

  if (process.env.DISCORD_AUTO_CREATE_TICKET_CATEGORY === 'false') return null;

  const category = await postDiscord(token, `/guilds/${guildId}/channels`, {
    name: categoryName,
    type: 4
  });
  return category.id;
}

async function getDiscordMember(token, guildId, userId) {
  return getDiscord(token, `/guilds/${guildId}/members/${userId}`);
}

async function memberHasManagementAccess(discordId) {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  const userId = cleanId(discordId);
  if (!userId) return false;
  if (!guildId || !token) return false;

  const member = await getDiscordMember(token, guildId, userId).catch(() => null);
  if (!member) return false;

  const allowedRoleIds = await resolveConfiguredRoleIds(
    token,
    guildId,
    [process.env.MANAGEMENT_ROLE_ID, process.env.MANAGEMENT_ROLE_IDS, process.env.DISCORD_MANAGEMENT_ROLE_ID],
    [process.env.MANAGEMENT_ROLE_NAME, process.env.MANAGEMENT_ROLE_NAMES]
  );
  return hasAnyRole(member.roles || [], allowedRoleIds);
}

async function fetchDiscordUserLabel(userId) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const cleanUserId = cleanId(userId);
  if (!token || !cleanUserId) return null;

  try {
    const user = await getDiscord(token, `/users/${cleanUserId}`);
    const username = user.discriminator && user.discriminator !== '0'
      ? `${user.username}#${user.discriminator}`
      : user.username;
    return user.global_name && user.global_name !== username
      ? `${user.global_name} (@${username})`
      : `@${username}`;
  } catch (error) {
    console.warn(`[Unova API] Discord user lookup failed: ${error.response?.data?.message || error.message}`);
    return null;
  }
}

function makeManagementMentionLine() {
  const roleIds = getManagementRoleIds();
  if (roleIds.length) {
    return `Management role: ${roleIds.map((roleId) => `<@&${roleId}>`).join(', ')}`;
  }
  return 'Management role: not configured';
}

function parsePriorityRoleRules() {
  return splitConfig(process.env.PRIORITY_ROLE_RULES).map((item) => {
    const [roleId, label, points] = item.split(':').map((part) => part.trim());
    return normalizePriorityRule({ roleId, label, points });
  }).filter(Boolean);
}

function normalizePriorityRule(value) {
  const roleId = cleanId(value.roleId);
  const points = Math.max(0, Math.min(100000, Number(value.points || 0)));
  if (!roleId || !Number.isFinite(points) || points <= 0) return null;
  return {
    id: roleId,
    roleId,
    label: String(value.label || 'Priority Role').trim().slice(0, 80),
    points
  };
}

function normalizePriorityOverride(value) {
  const discordId = cleanId(value.discordId);
  const points = Math.max(0, Math.min(100000, Number(value.points || 0)));
  if (!discordId || !Number.isFinite(points) || points <= 0) return null;
  return {
    id: discordId,
    discordId,
    label: String(value.label || 'Priority Override').trim().slice(0, 80),
    points
  };
}

function getPriorityRules() {
  if (!state.priorityRules.length) {
    state.priorityRules = parsePriorityRoleRules();
  }
  return state.priorityRules;
}

function getPriorityOverrides() {
  return state.priorityOverrides;
}

async function calculatePriority(discordId) {
  const userId = cleanId(discordId);
  if (!userId) return { points: 0, label: 'Standard Queue', matches: [] };

  const override = getPriorityOverrides().find((entry) => entry.discordId === userId);
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  const matches = [];
  let top = override ? { points: override.points, label: override.label, type: 'override' } : null;

  if (guildId && token) {
    const member = await getDiscordMember(token, guildId, userId).catch(() => null);
    const memberRoles = new Set(member?.roles || []);
    for (const rule of getPriorityRules()) {
      if (!memberRoles.has(rule.roleId)) continue;
      matches.push(rule);
      if (!top || rule.points > top.points) {
        top = { points: rule.points, label: rule.label, type: 'role', roleId: rule.roleId };
      }
    }
  }

  return {
    points: top?.points || 0,
    label: top?.label || 'Standard Queue',
    type: top?.type || 'standard',
    roleId: top?.roleId || null,
    matches
  };
}

async function applyDiscordBanRole(moderationAction) {
  if (moderationAction.action !== 'ban') return { skipped: 'not_ban' };

  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  const userId = cleanId(moderationAction.discordId);
  if (!guildId || !token || !userId) return { skipped: 'missing_discord_config_or_user' };

  const banRoleIds = await resolveConfiguredRoleIds(
    token,
    guildId,
    [process.env.DISCORD_BAN_ROLE_ID || process.env.BAN_ROLE_ID],
    [process.env.DISCORD_BAN_ROLE_NAME || process.env.BAN_ROLE_NAME || 'Banned']
  );
  const removeRoleIds = await resolveConfiguredRoleIds(
    token,
    guildId,
    [process.env.DISCORD_BAN_REMOVE_ROLE_IDS || process.env.BAN_REMOVE_ROLE_IDS],
    [process.env.DISCORD_BAN_REMOVE_ROLE_NAMES || process.env.BAN_REMOVE_ROLE_NAMES]
  );

  if (!banRoleIds.length && !removeRoleIds.length) return { skipped: 'no_role_config' };

  try {
    const member = await getDiscordMember(token, guildId, userId);
    const nextRoles = new Set(member.roles || []);
    for (const roleId of removeRoleIds) nextRoles.delete(roleId);
    for (const roleId of banRoleIds) nextRoles.add(roleId);
    await patchDiscord(token, `/guilds/${guildId}/members/${userId}`, {
      roles: [...nextRoles]
    });
    return {
      ok: true,
      addedRoleIds: banRoleIds,
      removedRoleIds: removeRoleIds
    };
  } catch (error) {
    console.warn(`[Unova API] Discord ban role update failed: ${error.response?.data?.message || error.message}`);
    return {
      ok: false,
      error: error.response?.data?.message || error.message
    };
  }
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
    topic: `unova-management-ticket | source=${moderationAction.source} | action=${moderationAction.action} | id=${moderationAction.id}`,
    permission_overwrites: buildTicketOverwrites(targetDiscordId ? [targetDiscordId] : [])
  };

  try {
    const categoryId = await resolveTicketCategoryId(token, guildId).catch((error) => {
      console.warn(`[Unova API] Ticket category lookup failed: ${error.response?.data?.message || error.message}`);
      return null;
    });
    if (categoryId) body.parent_id = categoryId;

    const channel = await postDiscord(token, `/guilds/${guildId}/channels`, body);
    const targetLine = targetDiscordId
      ? `Target Discord: ${moderationAction.targetDiscordName || `<@${targetDiscordId}>`} (${targetDiscordId})`
      : 'Target Discord: not linked/provided';
    const moderatorLine = moderationAction.moderatorDiscordId
      ? `Moderator: ${moderationAction.moderatorDiscordName || `<@${moderationAction.moderatorDiscordId}>`} (${moderationAction.moderatorDiscordId})`
      : `Moderator: ${moderationAction.moderatorDisplayName || 'Firebase dashboard user'}`;

    await postDiscord(token, `/channels/${channel.id}/messages`, {
      content: [
        '**FiveM moderation ticket opened**',
        makeManagementMentionLine(),
        `Action: ${moderationAction.action.toUpperCase()}`,
        `Reason: ${moderationAction.reason}`,
        targetLine,
        `FiveM player ID: ${moderationAction.playerId || 'unknown'}`,
        `FiveM name: ${moderationAction.playerName || 'unknown'}`,
        `License: ${moderationAction.license || 'unknown'}`,
        moderatorLine,
        '',
        'Only management access, bot access, and explicitly added users can see this ticket.'
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

function normalizeModerator(moderator) {
  if (typeof moderator === 'string') {
    return { discordId: cleanId(moderator), displayName: null, role: null, firebaseUid: null, email: null };
  }

  const source = moderator || {};
  return {
    discordId: cleanId(source.discordId),
    displayName: source.name || source.email || null,
    role: source.role || null,
    firebaseUid: source.uid || source.firebaseUid || null,
    email: source.email || null
  };
}

async function recordModerationAction(action, body, moderator, source) {
  const cleanModerationAction = cleanAction(action);
  if (!cleanModerationAction) {
    return { status: 400, payload: { error: 'Invalid action.' } };
  }

  const reason = String(body.reason || '').trim();
  if (!reason) {
    return { status: 400, payload: { error: 'Reason is required.' } };
  }

  const normalizedModerator = normalizeModerator(moderator);
  const [targetDiscordName, moderatorDiscordName] = await Promise.all([
    fetchDiscordUserLabel(body.discordId),
    fetchDiscordUserLabel(normalizedModerator.discordId)
  ]);
  const moderationAction = {
    id: Date.now().toString(),
    action: cleanModerationAction,
    discordId: cleanId(body.discordId),
    targetDiscordName,
    citizenid: body.citizenid || null,
    license: body.license || null,
    playerId: body.playerId || null,
    playerName: body.playerName || null,
    reason,
    moderatorDiscordId: normalizedModerator.discordId,
    moderatorDiscor