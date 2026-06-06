const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const admin = require('firebase-admin');
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
  staff: 1,
  senior_staff: 2,
  staff_manager: 3,
  server_manager: 4,
  co_owner: 5,
  owner: 6,
  founder: 7
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
const unovaLogoUrl = 'https://r2.fivemanage.com/O8nsC8f5nKWaQAbWhOnvx/IMG_1324.PNG';
const stateObjectName = process.env.UNOVA_STATE_OBJECT || 'unova-dashboard-state.json';
const lockedFounderEmail = String(process.env.LOCKED_FOUNDER_EMAIL || 'jackhodgyuk@gmail.com').trim().toLowerCase();
const defaultDiscordLogChannelId = '1451550213595467889';
const defaultAnnouncementChannelId = '1450774864427352175';
const defaultLoaChannelId = '1512627150623080551';
const spectateFrameIntervalMs = 100;
const announcementTagRoleIds = new Set([
  '1450651506930880516',
  '1483451364703998005',
  '1475496342296989696',
  '1475496508911780093'
]);
const storage = new Storage();
let firebaseAdminApp = null;

const state = {
  fivemOnlinePlayers: [],
  latestStatus: null,
  moderationQueue: [],
  cityNotifications: [],
  recentModerationActions: [],
  spectateSessions: {},
  priorityRules: [],
  priorityOverrides: [],
  openTickets: [],
  loas: [],
  stateLoaded: false,
  stateLoadPromise: null,
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

function getStateBucketName() {
  return process.env.UNOVA_STATE_BUCKET
    || process.env.STATE_BUCKET
    || (process.env.GOOGLE_CLOUD_PROJECT ? `${process.env.GOOGLE_CLOUD_PROJECT}-unova-dashboard-state` : null);
}

function persistentStatePayload() {
  return {
    priorityRules: state.priorityRules,
    priorityOverrides: state.priorityOverrides,
    openTickets: state.openTickets,
    loas: state.loas,
    savedAt: new Date().toISOString()
  };
}

async function ensureStateLoaded() {
  if (state.stateLoaded) return;
  if (state.stateLoadPromise) return state.stateLoadPromise;

  state.stateLoadPromise = (async () => {
    const bucketName = getStateBucketName();
    if (!bucketName) {
      state.priorityRules = parsePriorityRoleRules();
      state.stateLoaded = true;
      return;
    }

    try {
      const bucket = storage.bucket(bucketName);
      const [exists] = await bucket.exists();
      if (!exists) {
        await bucket.create({
          location: process.env.UNOVA_STATE_BUCKET_LOCATION || 'europe-west1',
          uniformBucketLevelAccess: true
        });
      }

      const file = bucket.file(stateObjectName);
      const [fileExists] = await file.exists();
      if (fileExists) {
        const [contents] = await file.download();
        const stored = JSON.parse(contents.toString('utf8'));
        state.priorityRules = Array.isArray(stored.priorityRules) ? stored.priorityRules.map(normalizePriorityRule).filter(Boolean) : [];
        state.priorityOverrides = Array.isArray(stored.priorityOverrides) ? stored.priorityOverrides.map(normalizePriorityOverride).filter(Boolean) : [];
        state.openTickets = Array.isArray(stored.openTickets) ? stored.openTickets.map(normalizeOpenTicket).filter(Boolean) : [];
        state.loas = Array.isArray(stored.loas) ? stored.loas.map(normalizeLoa).filter(Boolean) : [];
      }

      if (!state.priorityRules.length) {
        state.priorityRules = parsePriorityRoleRules();
      }
    } catch (error) {
      console.warn(`[Unova API] Persistent state unavailable: ${error.message}`);
      if (!state.priorityRules.length) state.priorityRules = parsePriorityRoleRules();
    } finally {
      state.stateLoaded = true;
    }
  })();

  return state.stateLoadPromise;
}

async function savePersistentState() {
  const bucketName = getStateBucketName();
  if (!bucketName) return;

  try {
    const bucket = storage.bucket(bucketName);
    await bucket.file(stateObjectName).save(JSON.stringify(persistentStatePayload(), null, 2), {
      contentType: 'application/json; charset=utf-8',
      resumable: false
    });
  } catch (error) {
    console.warn(`[Unova API] Persistent state save failed: ${error.message}`);
  }
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

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
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

function getFirebaseAdminAuth() {
  if (!firebaseAdminApp) {
    firebaseAdminApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || firebasePublicConfigFallback.projectId
    });
  }

  return firebaseAdminApp.auth();
}

function normalizeDashboardRole(value) {
  const role = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (role === 'coowner' || role === 'co_owner') return 'co_owner';
  if (role === 'servermanager' || role === 'server_manager') return 'server_manager';
  if (role === 'staffmanager' || role === 'staff_manager') return 'staff_manager';
  if (role === 'seniorstaff' || role === 'senior_staff') return 'senior_staff';
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
  if (claims.serverManager === true || claims.server_manager === true) roles.add('server_manager');
  if (claims.staffManager === true || claims.staff_manager === true) roles.add('staff_manager');
  if (claims.seniorStaff === true || claims.senior_staff === true) roles.add('senior_staff');
  if (claims.management === true || claims.unovaManagement === true) roles.add('staff');
  return [...roles].sort((a, b) => dashboardRoleRank[b] - dashboardRoleRank[a]);
}

function isLockedFounderEmail(email) {
  return lockedFounderEmail && String(email || '').trim().toLowerCase() === lockedFounderEmail;
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

function publicFirebaseUser(userRecord) {
  const claims = userRecord.customClaims || {};
  const roles = new Set(getDashboardRolesFromClaims(claims));
  if (isLockedFounderEmail(userRecord.email)) roles.add('founder');
  const roleList = [...roles].sort((a, b) => dashboardRoleRank[b] - dashboardRoleRank[a]);
  const fallbackName = userRecord.displayName || `Firebase User ${String(userRecord.uid).slice(-6)}`;
  return {
    uid: userRecord.uid,
    name: fallbackName,
    email: userRecord.email || null,
    picture: userRecord.photoURL || null,
    disabled: userRecord.disabled === true,
    roles: roleList,
    role: getPrimaryDashboardRole(roleList),
    createdAt: userRecord.metadata?.creationTime || null,
    lastSignInAt: userRecord.metadata?.lastSignInTime || null
  };
}

function dashboardClaimsWithRole(existingClaims, role) {
  const nextClaims = { ...(existingClaims || {}) };
  delete nextClaims.unovaRole;
  delete nextClaims.dashboardRole;
  delete nextClaims.role;
  delete nextClaims.roles;
  delete nextClaims.unovaRoles;
  delete nextClaims.founder;
  delete nextClaims.owner;
  delete nextClaims.coOwner;
  delete nextClaims.co_owner;
  delete nextClaims.admin;
  delete nextClaims.management;
  delete nextClaims.unovaManagement;

  if (role) nextClaims.unovaRole = role;
  return nextClaims;
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
  const roles = new Set(getDashboardRolesFromClaims(claims));
  if (isLockedFounderEmail(payload.email)) roles.add('founder');
  const roleList = [...roles].sort((a, b) => dashboardRoleRank[b] - dashboardRoleRank[a]);
  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || null,
    emailVerified: payload.email_verified === true,
    name: payload.name || null,
    picture: payload.picture || null,
    discordId: getClaimDiscordId(claims),
    claims,
    roles: roleList,
    role: getPrimaryDashboardRole(roleList)
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
      message: 'Set a Firebase custom claim: unovaRole founder, owner, co_owner, server_manager, staff_manager, senior_staff, or staff.',
        requiredRoles: ['founder', 'owner', 'co_owner', 'server_manager', 'staff_manager', 'senior_staff', 'staff']
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

function requireInternal(req, res) {
  if (process.env.FIVEM_API_KEY && req.headers['x-api-key'] === process.env.FIVEM_API_KEY) return true;
  sendJson(res, 401, { error: 'Invalid internal API key.' });
  return false;
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

function getStaffRoleIds() {
  return cleanIdList(
    process.env.STAFF_ROLE_ID,
    process.env.STAFF_ROLE_IDS
  );
}

function managementLadderRoleConfig() {
  return {
    management: {
      ids: [process.env.MANAGEMENT_ROLE_ID, process.env.MANAGEMENT_ROLE_IDS, process.env.DISCORD_MANAGEMENT_ROLE_ID],
      names: [process.env.MANAGEMENT_ROLE_NAME, process.env.MANAGEMENT_ROLE_NAMES, 'Management', 'Unova Management']
    },
    staff: {
      ids: [process.env.STAFF_ROLE_ID, process.env.STAFF_ROLE_IDS],
      names: [process.env.STAFF_ROLE_NAME, process.env.STAFF_ROLE_NAMES, 'Staff']
    },
    senior_staff: {
      ids: [process.env.SENIOR_STAFF_ROLE_ID, process.env.SENIOR_STAFF_ROLE_IDS],
      names: [process.env.SENIOR_STAFF_ROLE_NAME, process.env.SENIOR_STAFF_ROLE_NAMES, 'Senior Staff']
    },
    staff_manager: {
      ids: [process.env.STAFF_MANAGER_ROLE_ID, process.env.STAFF_MANAGER_ROLE_IDS],
      names: [process.env.STAFF_MANAGER_ROLE_NAME, process.env.STAFF_MANAGER_ROLE_NAMES, 'Staff Manager']
    },
    server_manager: {
      ids: [process.env.SERVER_MANAGER_ROLE_ID, process.env.SERVER_MANAGER_ROLE_IDS],
      names: [process.env.SERVER_MANAGER_ROLE_NAME, process.env.SERVER_MANAGER_ROLE_NAMES, 'Server Manager']
    },
    co_owner: {
      ids: [process.env.CO_OWNER_ROLE_ID, process.env.CO_OWNER_ROLE_IDS],
      names: [process.env.CO_OWNER_ROLE_NAME, process.env.CO_OWNER_ROLE_NAMES, 'Co Owner', 'Co-Owner', 'Co Owner(s)', 'Co-Owners']
    },
    owner: {
      ids: [process.env.OWNER_ROLE_ID, process.env.OWNER_ROLE_IDS],
      names: [process.env.OWNER_ROLE_NAME, process.env.OWNER_ROLE_NAMES, 'Owner', 'Owners']
    },
    founder: {
      ids: [process.env.FOUNDER_ROLE_ID, process.env.FOUNDER_ROLE_IDS],
      names: [process.env.FOUNDER_ROLE_NAME, process.env.FOUNDER_ROLE_NAMES, 'Founder', 'Founders']
    },
    developer: {
      ids: [process.env.DEVELOPER_ROLE_ID, process.env.DEVELOPER_ROLE_IDS, '1450751628956270644'],
      names: [process.env.DEVELOPER_ROLE_NAME, process.env.DEVELOPER_ROLE_NAMES, 'Developer', 'Developers', 'Dev']
    },
    head_developer: {
      ids: [process.env.HEAD_DEVELOPER_ROLE_ID, process.env.HEAD_DEVELOPER_ROLE_IDS, '1450778341371281563'],
      names: [process.env.HEAD_DEVELOPER_ROLE_NAME, process.env.HEAD_DEVELOPER_ROLE_NAMES, 'Head Developer', 'Head Developers', 'Head Dev']
    }
  };
}

function cleanAction(value) {
  return ['warn', 'kick', 'ban', 'revive', 'down', 'spectate'].includes(value) ? value : null;
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

function buildTicketOverwrites(extraUserIds = [], allowedRoleIds = getTicketAccessRoleIds()) {
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
  for (const roleId of allowedRoleIds) {
    addOverwrite(roleId, 0, ticketAllow, null);
  }
  addOverwrite(botRoleId, 0, ticketAllow, null);
  addOverwrite(botUserId, 1, ticketAllow, null);

  for (const userId of extraUserIds.map(cleanId).filter(Boolean)) {
    addOverwrite(userId, 1, ticketAllow, null);
  }

  return overwrites;
}

function makeRoleMentionLine(roleIds, fallback) {
  const ids = cleanIdList(roleIds.join(','));
  if (ids.length) return ids.map((roleId) => `<@&${roleId}>`).join(' ');
  return fallback;
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

async function discordMultipartRequest(token, route, payload, attachment) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([attachment.buffer], { type: attachment.contentType }), attachment.filename);

  const response = await fetch(`${discordApiBase}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`
    },
    body: form,
    signal: AbortSignal.timeout(15000)
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

async function sendDiscordDm(userId, content) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const recipientId = cleanId(userId);
  if (!token || !recipientId || !content) return null;

  try {
    const channel = await postDiscord(token, '/users/@me/channels', { recipient_id: recipientId });
    return await postDiscord(token, `/channels/${channel.id}/messages`, {
      content: String(content).slice(0, 1900),
      allowed_mentions: { parse: [] }
    });
  } catch (error) {
    console.warn(`[Unova API] LOA DM failed: ${error.response?.data?.message || error.message}`);
    return null;
  }
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

async function resolveManagementLadderRoleIds(token, guildId) {
  const config = managementLadderRoleConfig();
  const allIds = [];
  const allNames = [];
  for (const roleConfig of Object.values(config)) {
    allIds.push(...roleConfig.ids);
    allNames.push(...roleConfig.names);
  }
  return resolveConfiguredRoleIds(token, guildId, allIds, allNames);
}

async function fetchDiscordGuildMembers(token, guildId) {
  const members = [];
  let after = '0';
  while (true) {
    const page = await getDiscord(token, `/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (!Array.isArray(page) || !page.length) break;
    members.push(...page);
    after = page[page.length - 1]?.user?.id;
    if (!after || page.length < 1000) break;
  }
  return members;
}

function publicDiscordMember(member) {
  const user = member?.user || {};
  const displayName = String(
    member?.nick
      || user.global_name
      || user.username
      || user.id
      || 'Unova Management'
  ).trim();
  return {
    discordId: cleanId(user.id),
    displayName,
    username: user.username || displayName
  };
}

async function listManagementDiscordMembers() {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) return [];

  const allowedRoleIds = await resolveManagementLadderRoleIds(token, guildId);
  if (!allowedRoleIds.length) return [];

  const members = await fetchDiscordGuildMembers(token, guildId);
  return members
    .filter((member) => !member?.user?.bot && hasAnyRole(member.roles || [], allowedRoleIds))
    .map(publicDiscordMember)
    .filter((member) => member.discordId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function memberHasManagementLadderAccess(discordId) {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  const userId = cleanId(discordId);
  if (!userId || !guildId || !token) return false;

  const member = await getDiscordMember(token, guildId, userId).catch(() => null);
  if (!member) return false;

  const allowedRoleIds = await resolveManagementLadderRoleIds(token, guildId);
  return hasAnyRole(member.roles || [], allowedRoleIds);
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

async function memberHasLeadershipAccess(discordId) {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  const userId = cleanId(discordId);
  if (!userId || !guildId || !token) return false;

  const member = await getDiscordMember(token, guildId, userId).catch(() => null);
  if (!member) return false;

  const roleIds = await resolveConfiguredRoleIds(
    token,
    guildId,
    [
      process.env.CO_OWNER_ROLE_ID,
      process.env.CO_OWNER_ROLE_IDS,
      process.env.OWNER_ROLE_ID,
      process.env.OWNER_ROLE_IDS,
      process.env.FOUNDER_ROLE_ID,
      process.env.FOUNDER_ROLE_IDS
    ],
    [
      process.env.CO_OWNER_ROLE_NAME,
      process.env.CO_OWNER_ROLE_NAMES,
      process.env.OWNER_ROLE_NAME,
      process.env.OWNER_ROLE_NAMES,
      process.env.FOUNDER_ROLE_NAME,
      process.env.FOUNDER_ROLE_NAMES
    ]
  );

  return hasAnyRole(member.roles || [], roleIds) || userId === cleanId(process.env.FOUNDER_DISCORD_ID);
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

async function logDiscordAction(lines) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = cleanId(process.env.DISCORD_LOG_CHANNEL_ID) || defaultDiscordLogChannelId;
  if (!token || !channelId) return;
  await postDiscord(token, `/channels/${channelId}/messages`, {
    content: lines.filter(Boolean).join('\n').slice(0, 1900),
    allowed_mentions: { parse: [] }
  }).catch((error) => {
    console.warn(`[Unova API] Discord log failed: ${error.response?.data?.message || error.message}`);
  });
}

function parseEmbedColor(value) {
  const raw = String(value || '').trim();
  if (!raw) return 2807784;
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw.replace(/^0x/i, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return 2807784;
  return Number.parseInt(normalized, 16);
}

function normalizeRoleMentions(value) {
  return cleanIdList(
    String(value || '')
      .replace(/<@&(\d{15,25})>/g, '$1')
      .replace(/[^\d, ]/g, ',')
  )
    .filter((roleId) => announcementTagRoleIds.has(roleId))
    .slice(0, 1);
}

function normalizeImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function normalizeAnnouncementAttachment(upload) {
  if (!upload || typeof upload !== 'object') return null;
  const dataUrl = String(upload.dataUrl || '');
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null;

  const extension = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
  }[match[1].toLowerCase()] || 'png';

  return {
    buffer,
    contentType: match[1].toLowerCase(),
    filename: `unova-announcement.${extension}`
  };
}

async function postDashboardAnnouncement(body, user) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = cleanId(process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID) || defaultAnnouncementChannelId;
  if (!token || !channelId) {
    return { status: 500, payload: { error: 'Discord announcement channel is not configured.' } };
  }

  const title = String(body.title || 'Unova Announcement').trim().slice(0, 256);
  const footerName = String(body.authorName || user.name || 'Staff').trim().slice(0, 256) || 'Staff';
  const message = String(body.message || '').trim().slice(0, 3900);
  if (!message) {
    return { status: 400, payload: { error: 'Announcement text is required.' } };
  }

  const roleIds = normalizeRoleMentions(body.roleIds || body.roleId || body.tagRoles);
  const imageUrl = normalizeImageUrl(body.imageUrl);
  const attachment = normalizeAnnouncementAttachment(body.upload);
  const embed = {
    color: parseEmbedColor(body.color),
    author: {
      name: 'Unova Roleplay',
      icon_url: unovaLogoUrl
    },
    title,
    description: message,
    footer: { text: `Unova Management • ${footerName}` },
    timestamp: new Date().toISOString()
  };
  if (imageUrl) embed.image = { url: imageUrl };
  if (attachment) embed.image = { url: `attachment://${attachment.filename}` };

  const payload = {
    content: roleIds.map((roleId) => `<@&${roleId}>`).join(' ') || undefined,
    embeds: [embed],
    allowed_mentions: { roles: roleIds }
  };

  const posted = attachment
    ? await discordMultipartRequest(token, `/channels/${channelId}/messages`, payload, attachment)
    : await postDiscord(token, `/channels/${channelId}/messages`, payload);

  await logDiscordAction([
    '**Dashboard Announcement Posted**',
    `Actor: ${user.name || user.uid} (${user.role || 'unknown role'})`,
    `Channel: <#${channelId}>`,
    `Title: ${title}`,
    roleIds.length ? `Tagged roles: ${roleIds.map((roleId) => `<@&${roleId}>`).join(', ')}` : 'Tagged roles: none'
  ]);

  return {
    status: 200,
    payload: {
      ok: true,
      messageId: posted.id,
      channelId,
      url: `https://discord.com/channels/${process.env.DISCORD_GUILD_ID || '@me'}/${channelId}/${posted.id}`
    }
  };
}

function loaStatusEmbed(pendingLoas, activeLoas) {
  const pendingText = pendingLoas.length
    ? pendingLoas.slice(0, 12).map((loa, index) => [
      `**${index + 1}. ${loa.displayName || 'Unova Management'}**`,
      `<@${loa.discordId}>`,
      `${loa.from} to ${loa.to}`,
      loa.reason ? `Reason: ${loa.reason}` : null
    ].filter(Boolean).join('\n')).join('\n\n') + (pendingLoas.length > 12 ? `\n\n…and ${pendingLoas.length - 12} more pending LOAs on the dashboard.` : '')
    : 'No pending LOAs.';

  const activeText = activeLoas.length
    ? activeLoas.slice(0, 12).map((loa, index) => [
      `**${index + 1}. ${loa.displayName || 'Unova Management'}**`,
      `<@${loa.discordId}>`,
      `${loa.from} to ${loa.to}`,
      loa.reason ? `Reason: ${loa.reason}` : null
    ].filter(Boolean).join('\n')).join('\n\n') + (activeLoas.length > 12 ? `\n\n…and ${activeLoas.length - 12} more active LOAs on the dashboard.` : '')
    : 'No approved active LOAs.';

  return {
    color: 2807784,
    title: 'LOA Status',
    description: [
      '**Pending Founder Approval**',
      pendingText,
      '',
      '**Approved And Active**',
      activeText
    ].join('\n'),
    thumbnail: { url: unovaLogoUrl },
    footer: { text: 'Unova Management LOA' },
    timestamp: new Date().toISOString()
  };
}

async function updateDiscordLoaStatusMessage() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = cleanId(process.env.DISCORD_LOA_CHANNEL_ID) || defaultLoaChannelId;
  if (!token || !channelId) return null;

  const [pendingLoas, activeLoas] = await Promise.all([getPendingLoas(), getActiveLoas()]);
  const embed = loaStatusEmbed(pendingLoas, activeLoas);
  const messages = await getDiscord(token, `/channels/${channelId}/messages?limit=50`).catch((error) => {
    console.warn(`[Unova API] LOA status fetch failed: ${error.response?.data?.message || error.message}`);
    return [];
  });
  const existing = Array.isArray(messages)
    ? messages.find((message) =>
      message.author?.bot
      && message.embeds?.some((item) => item.title === 'LOA Status' || item.title === 'Active LOA')
    )
    : null;

  if (existing) {
    return patchDiscord(token, `/channels/${channelId}/messages/${existing.id}`, { embeds: [embed] }).catch((error) => {
      console.warn(`[Unova API] LOA status edit failed: ${error.response?.data?.message || error.message}`);
      return null;
    });
  }

  return postDiscord(token, `/channels/${channelId}/messages`, { embeds: [embed] }).catch((error) => {
    console.warn(`[Unova API] LOA status post failed: ${error.response?.data?.message || error.message}`);
    return null;
  });
}

function normalizeOpenTicket(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  if (!id) return null;
  return {
    id,
    channelId: cleanId(value.channelId),
    guildId: cleanId(value.guildId) || cleanId(process.env.DISCORD_GUILD_ID),
    channelName: String(value.channelName || value.name || 'ticket').slice(0, 100),
    kind: String(value.kind || 'ticket').slice(0, 40),
    level: String(value.level || 'management').slice(0, 40),
    openerId: cleanId(value.openerId),
    openerName: String(value.openerName || '').slice(0, 120),
    targetId: cleanId(value.targetId),
    targetName: String(value.targetName || '').slice(0, 120),
    source: String(value.source || 'discord').slice(0, 60),
    locked: value.locked === true || value.locked === 'true',
    status: value.status === 'closed' ? 'closed' : 'open',
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || value.createdAt || new Date().toISOString()
  };
}

async function upsertOpenTicket(ticket) {
  await ensureStateLoaded();
  const normalized = normalizeOpenTicket(ticket);
  if (!normalized) return null;
  const existing = state.openTickets.find((item) => item.id === normalized.id || item.channelId === normalized.channelId);
  const merged = existing ? {
    ...existing,
    ...normalized,
    openerName: normalized.openerName || existing.openerName,
    targetName: normalized.targetName || existing.targetName,
    targetId: normalized.targetId || existing.targetId,
    createdAt: existing.createdAt || normalized.createdAt
  } : normalized;
  state.openTickets = state.openTickets.filter((item) => item.id !== merged.id && item.channelId !== merged.channelId);
  state.openTickets.unshift(merged);
  state.openTickets = state.openTickets.slice(0, 250);
  await savePersistentState();
  return merged;
}

async function closeOpenTicket(id) {
  await ensureStateLoaded();
  const ticketId = String(id || '').trim();
  const existing = state.openTickets.find((item) => item.id === ticketId || item.channelId === ticketId);
  if (!existing) return null;
  existing.status = 'closed';
  existing.updatedAt = new Date().toISOString();
  await savePersistentState();
  return existing;
}

async function activeTickets() {
  await ensureStateLoaded();
  return state.openTickets.filter((ticket) => ticket.status !== 'closed');
}

async function activeTicketByChannelId(channelId) {
  const cleanChannelId = cleanId(channelId);
  if (!cleanChannelId) return null;
  const tickets = await activeTickets();
  return tickets.find((ticket) => ticket.channelId === cleanChannelId) || null;
}

function publicDiscordTicketMessage(message) {
  const author = message.author || {};
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return {
    id: cleanId(message.id),
    authorId: cleanId(author.id),
    authorName: author.global_name || author.username || 'Unknown',
    bot: author.bot === true,
    content: String(message.content || '').slice(0, 1800),
    createdAt: message.timestamp || null,
    editedAt: message.edited_timestamp || null,
    attachments: attachments.map((attachment) => ({
      id: cleanId(attachment.id),
      name: String(attachment.filename || 'attachment').slice(0, 120),
      url: String(attachment.url || '').slice(0, 500)
    })).slice(0, 5)
  };
}

async function getDiscordChannelMessages(token, channelId, maxMessages = 500) {
  const messages = [];
  let before = null;

  while (messages.length < maxMessages) {
    const limit = Math.min(100, maxMessages - messages.length);
    const route = `/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ''}`;
    const batch = await getDiscord(token, route);
    if (!Array.isArray(batch) || !batch.length) break;
    messages.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < limit) break;
  }

  return messages;
}

const discordPermissionBits = {
  administrator: 1n << 3n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n
};

function applyDiscordOverwrite(permissions, overwrite) {
  const deny = BigInt(overwrite.deny || '0');
  const allow = BigInt(overwrite.allow || '0');
  return (permissions & ~deny) | allow;
}

async function resolveDiscordChannelPermissions(channelId, userId) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const cleanChannelId = cleanId(channelId);
  const cleanUserId = cleanId(userId);
  if (!token || !guildId || !cleanChannelId || !cleanUserId) return { canView: false, canSend: false };

  const ticket = await activeTicketByChannelId(cleanChannelId);
  if (!ticket) return { canView: false, canSend: false };

  const [channel, member, roles] = await Promise.all([
    getDiscord(token, `/channels/${cleanChannelId}`),
    getDiscord(token, `/guilds/${guildId}/members/${cleanUserId}`),
    fetchDiscordRoles(token, guildId)
  ]);

  const memberRoleIds = new Set([guildId, ...(member.roles || []).map(cleanId).filter(Boolean)]);
  const roleById = new Map(roles.map((role) => [cleanId(role.id), role]));
  let permissions = BigInt(roleById.get(guildId)?.permissions || '0');
  for (const roleId of memberRoleIds) {
    if (roleId === guildId) continue;
    permissions |= BigInt(roleById.get(roleId)?.permissions || '0');
  }

  if ((permissions & discordPermissionBits.administrator) === discordPermissionBits.administrator) {
    return { canView: true, canSend: true };
  }

  const overwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  const everyoneOverwrite = overwrites.find((overwrite) => cleanId(overwrite.id) === guildId && Number(overwrite.type) === 0);
  if (everyoneOverwrite) permissions = applyDiscordOverwrite(permissions, everyoneOverwrite);

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (Number(overwrite.type) !== 0) continue;
    const overwriteId = cleanId(overwrite.id);
    if (overwriteId === guildId || !memberRoleIds.has(overwriteId)) continue;
    roleAllow |= BigInt(overwrite.allow || '0');
    roleDeny |= BigInt(overwrite.deny || '0');
  }
  permissions = (permissions & ~roleDeny) | roleAllow;

  const memberOverwrite = overwrites.find((overwrite) => cleanId(overwrite.id) === cleanUserId && Number(overwrite.type) === 1);
  if (memberOverwrite) permissions = applyDiscordOverwrite(permissions, memberOverwrite);

  return {
    canView: (permissions & discordPermissionBits.viewChannel) === discordPermissionBits.viewChannel,
    canSend: (permissions & discordPermissionBits.sendMessages) === discordPermissionBits.sendMessages
  };
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

function normalizeDateOnly(value) {
  const clean = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const date = new Date(`${clean}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return clean;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeLoa(value) {
  const discordId = cleanId(value.discordId || value.userId);
  const from = normalizeDateOnly(value.from || value.dateFrom);
  const to = normalizeDateOnly(value.to || value.dateTo);
  if (!discordId || !from || !to || from > to) return null;

  const rawStatus = String(value.status || 'pending').trim().toLowerCase();
  const status = ['pending', 'active', 'cancelled', 'declined'].includes(rawStatus) ? rawStatus : 'pending';
  return {
    id: discordId,
    discordId,
    displayName: String(value.displayName || value.name || 'Unova Management').trim().slice(0, 120),
    from,
    to,
    reason: String(value.reason || '').trim().slice(0, 500),
    status,
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString(),
    requestedBy: value.requestedBy || null,
    requestedByName: value.requestedByName || null,
    approvedBy: value.approvedBy || null,
    approvedByName: value.approvedByName || null,
    approvedAt: value.approvedAt || null,
    declinedBy: value.declinedBy || null,
    declinedByName: value.declinedByName || null,
    declinedAt: value.declinedAt || null,
    createdByFounder: value.createdByFounder === true
  };
}

async function getLoas() {
  await ensureStateLoaded();
  return state.loas.map(normalizeLoa).filter(Boolean);
}

function activeLoasFrom(records) {
  const today = todayDateOnly();
  return records
    .filter((loa) => loa.status === 'active' && loa.to >= today)
    .sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from) || a.displayName.localeCompare(b.displayName));
}

async function getActiveLoas() {
  return activeLoasFrom(await getLoas());
}

function pendingLoasFrom(records) {
  return records
    .filter((loa) => loa.status === 'pending')
    .sort((a, b) => a.from.localeCompare(b.from) || a.displayName.localeCompare(b.displayName));
}

async function getPendingLoas() {
  return pendingLoasFrom(await getLoas());
}

function cleanupSpectateSessions() {
  const now = Date.now();
  for (const [sessionId, session] of Object.entries(state.spectateSessions)) {
    if (!session.active && now - session.updatedAtMs > 60 * 1000) delete state.spectateSessions[sessionId];
    if (now - session.createdAtMs > 15 * 60 * 1000) delete state.spectateSessions[sessionId];
  }
}

function publicSpectateSession(session) {
  return {
    id: session.id,
    playerId: session.playerId,
    playerName: session.playerName,
    active: session.active,
    pending: session.pending,
    frameIntervalMs: session.frameIntervalMs || spectateFrameIntervalMs,
    image: session.image || null,
    error: session.error || null,
    updatedAt: session.updatedAt || null
  };
}

async function getPriorityRules() {
  await ensureStateLoaded();
  return state.priorityRules;
}

async function getPriorityOverrides() {
  await ensureStateLoaded();
  return state.priorityOverrides;
}

async function calculatePriority(discordId) {
  await ensureStateLoaded();
  const userId = cleanId(discordId);
  if (!userId) return { points: 0, label: 'Standard Queue', matches: [] };

  const override = state.priorityOverrides.find((entry) => entry.discordId === userId);
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  const matches = [];
  let top = override ? { points: override.points, label: override.label, type: 'override' } : null;

  if (guildId && token) {
    const member = await getDiscordMember(token, guildId, userId).catch(() => null);
    const memberRoles = new Set(member?.roles || []);
    for (const rule of state.priorityRules) {
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
      embeds: [{
        color: 2807784,
        thumbnail: { url: unovaLogoUrl },
        footer: { text: 'Unova Management' }
      }],
      allowed_mentions: {
        parse: ['roles', 'users']
      }
    });

    await upsertOpenTicket({
      id: channel.id,
      channelId: channel.id,
      guildId,
      channelName: channel.name,
      kind: `moderation:${moderationAction.action}`,
      level: 'management',
      openerId: moderationAction.moderatorDiscordId,
      openerName: moderationAction.moderatorDiscordName || moderationAction.moderatorDisplayName,
      targetId: targetDiscordId,
      targetName: moderationAction.targetDiscordName || moderationAction.playerName,
      source: moderationAction.source,
      locked: true,
      status: 'open'
    });

    return { id: channel.id, name: channel.name };
  } catch (error) {
    console.warn(`[Unova API] Discord ticket creation failed: ${error.response?.data?.message || error.message}`);
    return null;
  }
}

async function createDiscordPlayerReportTicket(report) {
  const guildId = cleanId(process.env.DISCORD_GUILD_ID);
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) return null;

  const reporterDiscordId = cleanId(report.reporterDiscordId);
  const offenderDiscordId = cleanId(report.offenderDiscordId);
  const staffRoleIds = getStaffRoleIds();
  const reportAccessRoleIds = staffRoleIds.length ? staffRoleIds : getTicketAccessRoleIds();
  const channelName = sanitizeChannelName(`report-${report.offenderPlayerId || 'unknown'}-${Date.now().toString().slice(-5)}`);
  const body = {
    name: channelName,
    type: 0,
    topic: `unova-support-ticket | kind=player_report | level=staff | opener=${report.reporterDiscordId || 'unknown'} | source=fivem-report | locked=false`,
    permission_overwrites: buildTicketOverwrites([reporterDiscordId].filter(Boolean), reportAccessRoleIds)
  };

  const categoryId = await resolveTicketCategoryId(token, guildId).catch(() => null);
  if (categoryId) body.parent_id = categoryId;

  try {
    const channel = await postDiscord(token, `/guilds/${guildId}/channels`, body);
    const staffLine = makeRoleMentionLine(reportAccessRoleIds, makeManagementMentionLine());
    await postDiscord(token, `/channels/${channel.id}/messages`, {
      content: [
        staffLine,
        '**New player report from city**',
        `Reporter: ${report.reporterName || 'unknown'}${reporterDiscordId ? ` (<@${reporterDiscordId}>)` : ''}`,
        `Possible offender: ${report.offenderName || 'unknown'} | City ID: ${report.offenderPlayerId || 'unknown'}${offenderDiscordId ? ` | <@${offenderDiscordId}>` : ''}`,
        `Bodycam: ${report.bodycamUrl}`,
        '',
        report.description
      ].join('\n'),
      embeds: [{
        color: 2807784,
        thumbnail: { url: unovaLogoUrl },
        footer: { text: 'Golden lottery ticket opened from city' }
      }],
      allowed_mentions: { parse: ['roles', 'users'] }
    });

    const ticket = await upsertOpenTicket({
      id: channel.id,
      channelId: channel.id,
      guildId,
      channelName: channel.name,
      kind: 'player_report',
      level: 'staff',
      openerId: reporterDiscordId,
      openerName: report.reporterName,
      targetId: offenderDiscordId,
      targetName: report.offenderName || `City ID ${report.offenderPlayerId}`,
      source: 'fivem-report',
      locked: false,
      status: 'open'
    });

    state.cityNotifications.push({
      id: Date.now().toString(),
      type: 'ticket',
      message: `New player report in Discord: ${channel.name}`,
      ticket,
      createdAt: new Date().toISOString()
    });
    state.cityNotifications = state.cityNotifications.slice(-50);
    return { id: channel.id, name: channel.name };
  } catch (error) {
    console.warn(`[Unova API] Player report ticket creation failed: ${error.response?.data?.message || error.message}`);
    return null;
  }
}

function normalizeModerator(moderator) {
  if (typeof moderator === 'string') {
    return { discordId: cleanId(moderator), displayName: null, role: null, firebaseUid: null, email: null };
  }

  const source = moderator || {};
  const discordId = cleanId(source.discordId)
    || (source.role === 'founder' ? cleanId(process.env.FOUNDER_DISCORD_ID) : null);
  return {
    discordId,
    displayName: source.name || 'Dashboard user',
    role: source.role || null,
    firebaseUid: source.uid || source.firebaseUid || null,
    email: null
  };
}

async function recordModerationAction(action, body, moderator, source) {
  const cleanModerationAction = cleanAction(action);
  if (!cleanModerationAction) {
    return { status: 400, payload: { error: 'Invalid action.' } };
  }

  const defaultReason = cleanModerationAction === 'revive'
    ? 'Revive requested'
    : cleanModerationAction === 'down'
    ? 'Marked dead by management'
    : cleanModerationAction === 'spectate'
    ? 'Spectate requested'
    : '';
  const reason = String(body.reason || defaultReason).trim();
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
    moderatorDiscordName,
    moderatorDisplayName: normalizedModerator.displayName,
    moderatorRole: normalizedModerator.role,
    moderatorFirebaseUid: normalizedModerator.firebaseUid,
    moderatorEmail: null,
    source,
    createdAt: new Date().toISOString()
  };

  if (moderationAction.action !== 'revive' && moderationAction.action !== 'down' && moderationAction.action !== 'spectate') {
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
  }

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

  const cityOnlyAction = moderationAction.action === 'revive' || moderationAction.action === 'down' || moderationAction.action === 'spectate';
  const discordRoleUpdate = cityOnlyAction ? { skipped: moderationAction.action } : await applyDiscordBanRole(moderationAction);
  const ticket = cityOnlyAction ? null : await createDiscordModerationTicket(moderationAction);
  moderationAction.ticket = ticket;
  await logDiscordAction([
    `**FiveM ${moderationAction.action.toUpperCase()}**`,
    `Source: ${moderationAction.source}`,
    `Moderator: ${moderationAction.moderatorDiscordId ? `<@${moderationAction.moderatorDiscordId}> (${moderationAction.moderatorDiscordId})` : moderationAction.moderatorDisplayName}`,
    `Moderator role: ${moderationAction.moderatorRole || 'unknown'}`,
    `Target: ${moderationAction.discordId ? `<@${moderationAction.discordId}> (${moderationAction.discordId})` : 'Discord not linked'}`,
    `FiveM: ${moderationAction.playerName || 'unknown'} / ID ${moderationAction.playerId || 'unknown'}`,
    `License: ${moderationAction.license || 'unknown'}`,
    `Reason: ${moderationAction.reason}`,
    ticket ? `Ticket: #${ticket.name}` : null,
    discordRoleUpdate?.ok ? `Discord roles: added ${discordRoleUpdate.addedRoleIds?.join(', ') || 'none'} removed ${discordRoleUpdate.removedRoleIds?.join(', ') || 'none'}` : null
  ]);
  state.moderationQueue.push(moderationAction);
  state.recentModerationActions.unshift(moderationAction);
  state.recentModerationActions = state.recentModerationActions.slice(0, 50);
  return { status: 200, payload: { ok: true, moderationAction, discordRoleUpdate, ticket } };
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

  if (req.method === 'GET' && pathname === '/dashboard/firebase-config') {
    sendJson(res, 200, getFirebasePublicConfig());
    return;
  }

  if (req.method === 'POST' && pathname === '/auth/firebase-login') {
    const body = await readBody(req);
    let firebaseUser;
    try {
      firebaseUser = await verifyFirebaseIdToken(body.idToken);
    } catch (error) {
      console.warn(`[Unova API] Firebase login rejected: ${error.message}`);
      sendJson(res, 401, { error: 'Invalid Firebase login.' });
      return;
    }

    if (!hasDashboardAccess(firebaseUser)) {
      sendJson(res, 403, {
        error: 'Firebase dashboard role required.',
        message: 'Set a Firebase custom claim: unovaRole founder, owner, co_owner, server_manager, staff_manager, senior_staff, or staff.',
        requiredRoles: ['founder', 'owner', 'co_owner', 'server_manager', 'staff_manager', 'senior_staff', 'staff']
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      user: publicDashboardUser(firebaseUser)
    });
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

  if (req.method === 'POST' && pathname === '/internal/tickets/upsert') {
    if (!requireInternal(req, res)) return;
    const ticket = await upsertOpenTicket(await readBody(req));
    sendJson(res, ticket ? 200 : 400, ticket ? { ok: true, ticket } : { error: 'Invalid ticket.' });
    return;
  }

  if (req.method === 'POST' && pathname === '/internal/tickets/close') {
    if (!requireInternal(req, res)) return;
    const body = await readBody(req);
    const ticket = await closeOpenTicket(body.id || body.channelId);
    sendJson(res, 200, { ok: true, ticket });
    return;
  }

  if (req.method === 'GET' && pathname === '/internal/loas') {
    if (!requireInternal(req, res)) return;
    sendJson(res, 200, { loas: await getLoas(), pendingLoas: await getPendingLoas(), activeLoas: await getActiveLoas() });
    return;
  }

  if (req.method === 'POST' && pathname === '/internal/loas/upsert') {
    if (!requireInternal(req, res)) return;
    const loa = normalizeLoa(await readBody(req));
    if (!loa) {
      sendJson(res, 400, { error: 'Valid LOA user, from date, and to date are required.' });
      return;
    }
    const now = new Date().toISOString();
    state.loas = (await getLoas()).filter((item) => item.discordId !== loa.discordId);
    state.loas.unshift({ ...loa, status: 'pending', updatedAt: now });
    await savePersistentState();
    await updateDiscordLoaStatusMessage();
    sendJson(res, 200, { ok: true, loa: { ...loa, status: 'pending', updatedAt: now }, pendingLoas: await getPendingLoas(), activeLoas: await getActiveLoas() });
    return;
  }

  if (req.method === 'POST' && pathname === '/internal/loas/cancel') {
    if (!requireInternal(req, res)) return;
    const body = await readBody(req);
    const discordId = cleanId(body.discordId || body.userId);
    if (!discordId) {
      sendJson(res, 400, { error: 'Valid Discord user ID is required.' });
      return;
    }
    const now = new Date().toISOString();
    state.loas = (await getLoas()).map((loa) => loa.discordId === discordId ? { ...loa, status: 'cancelled', updatedAt: now } : loa);
    await savePersistentState();
    await updateDiscordLoaStatusMessage();
    sendJson(res, 200, { ok: true, pendingLoas: await getPendingLoas(), activeLoas: await getActiveLoas() });
    return;
  }

  if (req.method === 'POST' && pathname === '/internal/city/notify') {
    if (!requireInternal(req, res)) return;
    const body = await readBody(req);
    state.cityNotifications.push({
      id: Date.now().toString(),
      type: body.type || 'ticket',
      message: String(body.message || 'New Discord ticket.').slice(0, 240),
      createdAt: new Date().toISOString()
    });
    state.cityNotifications = state.cityNotifications.slice(-50);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/access/check') {
    if (!requireFiveM(req, res)) return;

    const discordId = cleanId(requestUrl.searchParams.get('discordId'));
    sendJson(res, 200, {
      allowed: await memberHasManagementAccess(discordId),
      discordId
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/leadership/check') {
    if (!requireFiveM(req, res)) return;
    const discordId = cleanId(requestUrl.searchParams.get('discordId'));
    sendJson(res, 200, {
      allowed: await memberHasLeadershipAccess(discordId),
      discordId
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/tickets') {
    if (!requireFiveM(req, res)) return;
    sendJson(res, 200, { tickets: await activeTickets() });
    return;
  }

  const fivemTicketMessagesMatch = pathname.match(/^\/fivem\/tickets\/(\d+)\/messages$/);
  if (req.method === 'GET' && fivemTicketMessagesMatch) {
    if (!requireFiveM(req, res)) return;

    const channelId = fivemTicketMessagesMatch[1];
    const discordId = cleanId(requestUrl.searchParams.get('discordId'));
    const permissions = await resolveDiscordChannelPermissions(channelId, discordId).catch((error) => {
      console.warn(`[Unova API] Ticket permission check failed: ${error.response?.data?.message || error.message}`);
      return { canView: false, canSend: false };
    });
    if (!permissions.canView) {
      sendJson(res, 403, { error: 'Discord permissions do not allow this ticket.' });
      return;
    }

    const token = process.env.DISCORD_BOT_TOKEN;
    const ticket = await activeTicketByChannelId(channelId);
    const messages = await getDiscordChannelMessages(token, channelId);
    sendJson(res, 200, {
      ticket,
      canSend: permissions.canSend,
      messages: messages.map(publicDiscordTicketMessage).reverse()
    });
    return;
  }

  if (req.method === 'POST' && fivemTicketMessagesMatch) {
    if (!requireFiveM(req, res)) return;

    const channelId = fivemTicketMessagesMatch[1];
    const body = await readBody(req);
    const discordId = cleanId(body.discordId);
    const authorName = String(body.authorName || 'In-city staff').trim().slice(0, 80);
    const message = String(body.message || '').trim().slice(0, 1800);
    if (!message) {
      sendJson(res, 400, { error: 'Message is required.' });
      return;
    }

    const permissions = await resolveDiscordChannelPermissions(channelId, discordId).catch((error) => {
      console.warn(`[Unova API] Ticket send permission check failed: ${error.response?.data?.message || error.message}`);
      return { canView: false, canSend: false };
    });
    if (!permissions.canSend) {
      sendJson(res, 403, { error: 'Discord permissions do not allow sending in this ticket.' });
      return;
    }

    const sent = await postDiscord(process.env.DISCORD_BOT_TOKEN, `/channels/${channelId}/messages`, {
      content: `**In-city reply from ${authorName}**\n${message}`,
      allowed_mentions: { parse: [] }
    });
    sendJson(res, 200, { ok: true, message: publicDiscordTicketMessage(sent) });
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/priority/check') {
    if (!requireFiveM(req, res)) return;

    const discordId = cleanId(requestUrl.searchParams.get('discordId'));
    sendJson(res, 200, {
      discordId,
      priority: await calculatePriority(discordId)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/notifications/poll') {
    if (!requireFiveM(req, res)) return;
    const notifications = state.cityNotifications.splice(0, 25);
    sendJson(res, 200, { notifications });
    return;
  }

  if (req.method === 'GET' && pathname === '/fivem/spectate/requests') {
    if (!requireFiveM(req, res)) return;

    cleanupSpectateSessions();
    const now = Date.now();
    const requests = [];
    for (const session of Object.values(state.spectateSessions)) {
      if (!session.active || session.pending) continue;
      if (session.lastRequestAtMs && now - session.lastRequestAtMs < (session.frameIntervalMs || spectateFrameIntervalMs)) continue;
      session.pending = true;
      session.lastRequestAtMs = now;
      session.requestedAtMs = now;
      requests.push({
        sessionId: session.id,
        playerId: session.playerId,
        playerName: session.playerName,
        frameIntervalMs: session.frameIntervalMs || spectateFrameIntervalMs
      });
    }
    sendJson(res, 200, { requests });
    return;
  }

  if (req.method === 'POST' && pathname === '/fivem/spectate/frame') {
    if (!requireFiveM(req, res)) return;

    const body = await readBody(req, 12 * 1024 * 1024);
    const session = state.spectateSessions[String(body.sessionId || '')];
    if (!session) {
      sendJson(res, 404, { error: 'Spectate session not found.' });
      return;
    }

    session.pending = false;
    session.error = body.error ? String(body.error).slice(0, 240) : null;
    if (body.image) session.image = String(body.image);
    session.updatedAtMs = Date.now();
    session.updatedAt = new Date().toISOString();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/fivem/reports') {
    if (!requireFiveM(req, res)) return;
    const body = await readBody(req);
    const offenderPlayerId = Number(body.offenderPlayerId);
    const report = {
      reporterPlayerId: body.reporterPlayerId || null,
      reporterName: String(body.reporterName || 'unknown').slice(0, 120),
      reporterDiscordId: cleanId(body.reporterDiscordId),
      offenderPlayerId: Number.isFinite(offenderPlayerId) ? offenderPlayerId : null,
      offenderName: String(body.offenderName || 'unknown').slice(0, 120),
      offenderDiscordId: cleanId(body.offenderDiscordId),
      bodycamUrl: String(body.bodycamUrl || '').trim().slice(0, 500),
      description: String(body.description || '').trim().slice(0, 2000),
      createdAt: new Date().toISOString()
    };
    if (!report.offenderPlayerId || !report.bodycamUrl || !report.description) {
      sendJson(res, 400, { error: 'Offender player ID, bodycam link, and description are required.' });
      return;
    }
    const ticket = await createDiscordPlayerReportTicket(report);
    sendJson(res, ticket ? 200 : 500, ticket ? { ok: true, ticket } : { error: 'Could not open Discord ticket.' });
    return;
  }

  if (req.method === 'GET' && pathname === '/dashboard/status') {
    const user = await requireDashboardUser(req, res);
    if (!user) return;

    const fivem = await getPersistedStatus();
    sendJson(res, 200, {
      user: publicDashboardUser(user),
      fivem,
      players: fivem.players || [],
      queueLength: state.moderationQueue.length,
      recentActions: state.recentModerationActions,
      openTickets: hasDashboardRoleAtLeast(user, 'co_owner') ? await activeTickets() : [],
      pendingLoas: hasDashboardRoleAtLeast(user, 'founder') ? await getPendingLoas() : [],
      loas: await getActiveLoas()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/dashboard/loas/management-members') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    try {
      sendJson(res, 200, { members: await listManagementDiscordMembers() });
    } catch (error) {
      console.warn(`[Unova API] LOA management member lookup failed: ${error.response?.data?.message || error.message}`);
      sendJson(res, 500, { error: 'Could not load management members from Discord.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/loas/create') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const body = await readBody(req);
    const discordId = cleanId(body.discordId || body.userId);
    const from = normalizeDateOnly(body.from || body.dateFrom);
    const to = normalizeDateOnly(body.to || body.dateTo);
    if (!discordId || !from || !to || from > to) {
      sendJson(res, 400, { error: 'Management member, from date, and to date are required.' });
      return;
    }

    const hasManagement = await memberHasManagementLadderAccess(discordId);
    if (!hasManagement) {
      sendJson(res, 403, { error: 'That Discord member is not in a configured management role.' });
      return;
    }

    const guildId = cleanId(process.env.DISCORD_GUILD_ID);
    const token = process.env.DISCORD_BOT_TOKEN;
    const member = guildId && token ? await getDiscordMember(token, guildId, discordId).catch(() => null) : null;
    const publicMember = publicDiscordMember(member);
    const now = new Date().toISOString();
    const loa = {
      id: discordId,
      discordId,
      displayName: String(body.displayName || publicMember.displayName || 'Unova Management').trim().slice(0, 120),
      from,
      to,
      reason: String(body.reason || '').trim().slice(0, 500),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: user.uid,
      approvedByName: user.name || 'Founder',
      createdByFounder: true
    };

    state.loas = (await getLoas()).filter((item) => item.discordId !== discordId);
    state.loas.unshift(loa);
    await savePersistentState();
    await updateDiscordLoaStatusMessage();
    await logDiscordAction([
      '**LOA Created By Founder**',
      `Founder: ${user.name || user.uid}`,
      `Member: <@${loa.discordId}>`,
      `Dates: ${loa.from} to ${loa.to}`,
      loa.reason ? `Reason: ${loa.reason}` : null
    ]);

    sendJson(res, 200, { ok: true, loa, pendingLoas: await getPendingLoas(), activeLoas: await getActiveLoas() });
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/loas/request') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'staff')) return;
    if (user.role === 'founder') {
      sendJson(res, 403, { error: 'Founder can create approved LOAs instead.' });
      return;
    }

    const discordId = cleanId(user.discordId);
    if (!discordId) {
      sendJson(res, 400, { error: 'Your dashboard account needs a Discord ID before you can request LOA.' });
      return;
    }

    const body = await readBody(req);
    const from = normalizeDateOnly(body.from || body.dateFrom);
    const to = normalizeDateOnly(body.to || body.dateTo);
    if (!from || !to || from > to) {
      sendJson(res, 400, { error: 'Valid from and to dates are required.' });
      return;
    }

    const now = new Date().toISOString();
    const loa = {
      id: discordId,
      discordId,
      displayName: String(user.name || body.displayName || 'Unova Management').trim().slice(0, 120),
      from,
      to,
      reason: String(body.reason || '').trim().slice(0, 500),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      requestedBy: user.uid,
      requestedByName: user.name || user.uid
    };

    state.loas = (await getLoas()).filter((item) => item.discordId !== loa.discordId);
    state.loas.unshift(loa);
    await savePersistentState();
    await updateDiscordLoaStatusMessage();
    await logDiscordAction([
      '**LOA Requested From Dashboard**',
      `Member: <@${loa.discordId}>`,
      `Dates: ${loa.from} to ${loa.to}`,
      loa.reason ? `Reason: ${loa.reason}` : null
    ]);
    sendJson(res, 200, { ok: true, loa, pendingLoas: await getPendingLoas(), activeLoas: await getActiveLoas() });
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/loas/approve') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const body = await readBody(req);
    const discordId = cleanId(body.discordId || body.userId);
    if (!discordId) {
      sendJson(res, 400, { error: 'Valid Discord user ID is required.' });
      return;
    }

    const now = new Date().toISOString();
    let approved = null;
    state.loas = (await getLoas()).map((loa) => {
      if (loa.discordId !== discordId || loa.status !== 'pending') return loa;
      approved = { ...loa, status: 'active', approvedBy: user.uid, approvedByName: user.name || 'Founder', approvedAt: now, updatedAt: now };
      return approved;
    });
    if (!approved) {
      sendJson(res, 404, { error: 'No pending LOA was found for that user.' });
      return;
    }

    await savePersistentState();
    await updateDiscordLoaStatusMessage();
    await logDiscordAction([
      '**LOA Approved**',
      `Founder: ${user.name || user.uid}`,
      `Member: <@${approved.discordId}>`,
      `Dates: ${approved.from} to ${approved.to}`,
      approved.reason ? `Reason: ${approved.reason}` : null
    ]);
    await sendDiscordDm(
      approved.discordId,
      [
        'Your Unova Management LOA has been approved.',
        `Dates: ${approved.from} to ${approved.to}`,
        approved.reason ? `Reason: ${approved.reason}` : null
      ].filter(Boolean).join('\n')
    );
    sendJson(res, 200, { ok: true, loa: approved, pendingLoas: await getPendingLoas(), activeLoas: await getActiveLoas() });
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/loas/decline') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const body = await readBody(req);
    const discordId = cleanId(body.discordId || body.userId);
    if (!discordId) {
      sendJson(res, 400, { error: 'Valid Discord user ID is required.' });
      return;
    }

    const now = new Date().toISOString();
    let declined = null;
    state.loas = (await getLoas()).map((loa) => {
      if (loa.discordId !== discordId || loa.status !== 'pending') return loa;
      declined = { ...loa, status: 'declined', declinedBy: user.uid, declinedByName: user.name || 'Founder', declinedAt: now, updatedAt: now };
      return declined;
    });
    if (!declined) {
      sendJson(res, 404, { error: 'No pending LOA was found for that user.' });
      return;
    }

    await savePersistentState();
    await updateDiscordLoaStatusMessage();
    await logDiscordAction([
      '**LOA Declined**',
      `Founder: ${user.name || user.uid}`,
      `Member: <@${declined.discordId}>`,
      `Dates: ${declined.from} to ${declined.to}`,
      declined.reason ? `Reason: ${declined.reason}` : null
    ]);
    await sendDiscordDm(
      declined.discordId,
      [
        'Your Unova Management LOA has been declined.',
        `Dates: ${declined.from} to ${declined.to}`,
        declined.reason ? `Reason: ${declined.reason}` : null
      ].filter(Boolean).join('\n')
    );
    sendJson(res, 200, { ok: true, loa: declined, pendingLoas: await getPendingLoas(), activeLoas: await getActiveLoas() });
    return;
  }

  if (req.method === 'GET' && pathname === '/dashboard/priority') {
    const user = await requireDashboardUser(req, res);
    if (!user) return;

    sendJson(res, 200, {
      rules: await getPriorityRules(),
      overrides: await getPriorityOverrides()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/announcements') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'staff')) return;

    const result = await postDashboardAnnouncement(await readBody(req, 12 * 1024 * 1024), user);
    sendJson(res, result.status, result.payload);
    return;
  }

  if (req.method === 'GET' && pathname === '/dashboard/users') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    try {
      const result = await getFirebaseAdminAuth().listUsers(1000);
      sendJson(res, 200, { users: result.users.map(publicFirebaseUser) });
    } catch (error) {
      console.warn(`[Unova API] Firebase user list failed: ${error.message}`);
      sendJson(res, 500, { error: 'Could not load Firebase users.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/users/role') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const body = await readBody(req);
    const uid = String(body.uid || '').trim();
    const role = normalizeDashboardRole(body.role);
    const displayName = String(body.name || '').trim().slice(0, 80);
    const clearingRole = String(body.role || '').trim() === '';
    if (!uid || (!role && !clearingRole)) {
      sendJson(res, 400, { error: 'Valid Firebase UID and role are required.' });
      return;
    }
    if (uid === user.uid && role !== 'founder') {
      sendJson(res, 400, { error: 'You cannot remove founder access from your own account.' });
      return;
    }

    try {
      const auth = getFirebaseAdminAuth();
      const target = await auth.getUser(uid);
      if (isLockedFounderEmail(target.email) && role !== 'founder') {
        sendJson(res, 400, { error: `${lockedFounderEmail} is the locked founder account.` });
        return;
      }
      if (displayName) await auth.updateUser(uid, { displayName });
      await auth.setCustomUserClaims(uid, dashboardClaimsWithRole(target.customClaims, role));
      const updated = await auth.getUser(uid);
      sendJson(res, 200, { ok: true, user: publicFirebaseUser(updated) });
    } catch (error) {
      console.warn(`[Unova API] Firebase role update failed: ${error.message}`);
      sendJson(res, 500, { error: 'Could not update Firebase user role.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/priority/rules') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const rule = normalizePriorityRule(await readBody(req));
    if (!rule) {
      sendJson(res, 400, { error: 'Valid roleId and points are required.' });
      return;
    }
    state.priorityRules = (await getPriorityRules()).filter((item) => item.roleId !== rule.roleId);
    state.priorityRules.unshift(rule);
    await savePersistentState();
    sendJson(res, 200, { ok: true, rules: await getPriorityRules() });
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/priority/rules/delete') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const body = await readBody(req);
    const roleId = cleanId(body.roleId);
    state.priorityRules = (await getPriorityRules()).filter((item) => item.roleId !== roleId);
    await savePersistentState();
    sendJson(res, 200, { ok: true, rules: await getPriorityRules() });
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/priority/overrides') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const override = normalizePriorityOverride(await readBody(req));
    if (!override) {
      sendJson(res, 400, { error: 'Valid discordId and points are required.' });
      return;
    }
    state.priorityOverrides = (await getPriorityOverrides()).filter((item) => item.discordId !== override.discordId);
    state.priorityOverrides.unshift(override);
    await savePersistentState();
    sendJson(res, 200, { ok: true, overrides: await getPriorityOverrides() });
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/priority/overrides/delete') {
    const user = await requireDashboardUser(req, res);
    if (!user || !requireDashboardRole(user, res, 'founder')) return;

    const body = await readBody(req);
    const discordId = cleanId(body.discordId);
    state.priorityOverrides = (await getPriorityOverrides()).filter((item) => item.discordId !== discordId);
    await savePersistentState();
    sendJson(res, 200, { ok: true, overrides: await getPriorityOverrides() });
    return;
  }

  const dashboardModerationMatch = pathname.match(/^\/dashboard\/moderation\/([^/]+)$/);
  if (req.method === 'POST' && dashboardModerationMatch) {
    const user = await requireDashboardUser(req, res);
    if (!user) return;

    const result = await recordModerationAction(
      dashboardModerationMatch[1],
      await readBody(req),
      user,
      'dashboard'
    );
    sendJson(res, result.status, result.payload);
    return;
  }

  if (req.method === 'POST' && pathname === '/dashboard/spectate/start') {
    const user = await requireDashboardUser(req, res);
    if (!user) return;

    const body = await readBody(req);
    const playerId = Number(body.playerId);
    if (!Number.isFinite(playerId)) {
      sendJson(res, 400, { error: 'Valid playerId is required.' });
      return;
    }

    cleanupSpectateSessions();
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    state.spectateSessions[sessionId] = {
      id: sessionId,
      playerId,
      playerName: String(body.playerName || `ID ${playerId}`).slice(0, 80),
      requesterUid: user.uid,
      active: true,
      pending: false,
      frameIntervalMs: spectateFrameIntervalMs,
      lastRequestAtMs: 0,
      image: null,
      error: null,
      createdAtMs: now,
      updatedAtMs: now,
      updatedAt: new Date(now).toISOString()
    };
    sendJson(res, 200, { ok: true, session: publicSpectateSession(state.spectateSessions[sessionId]) });
    return;
  }

  const dashboardSpectateFrameMatch = pathname.match(/^\/dashboard\/spectate\/([^/]+)$/);
  if (req.method === 'GET' && dashboardSpectateFrameMatch) {
    const user = await requireDashboardUser(req, res);
    if (!user) return;

    cleanupSpectateSessions();
    const session = state.spectateSessions[dashboardSpectateFrameMatch[1]];
    if (!session || session.requesterUid !== user.uid) {
      sendJson(res, 404, { error: 'Spectate session not found.' });
      return;
    }
    sendJson(res, 200, { ok: true, session: publicSpectateSession(session) });
    return;
  }

  const dashboardSpectateStopMatch = pathname.match(/^\/dashboard\/spectate\/([^/]+)\/stop$/);
  if (req.method === 'POST' && dashboardSpectateStopMatch) {
    const user = await requireDashboardUser(req, res);
    if (!user) return;

    const session = state.spectateSessions[dashboardSpectateStopMatch[1]];
    if (session && session.requesterUid === user.uid) {
      session.active = false;
      session.pending = false;
      session.updatedAtMs = Date.now();
      session.updatedAt = new Date().toISOString();
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  const fivemModerationMatch = pathname.match(/^\/fivem\/(?:founder|admin)\/moderation\/([^/]+)$/);
  if (req.method === 'POST' && fivemModerationMatch) {
    if (!requireFiveM(req, res)) return;

    const body = await readBody(req);
    if (!await memberHasManagementAccess(body.moderatorDiscordId)) {
      sendJson(res, 403, { error: 'Management access required.' });
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
