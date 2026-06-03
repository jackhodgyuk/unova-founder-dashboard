require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const axios = require('axios');

if (!process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN === 'your_bot_token') {
  console.error('Missing DISCORD_BOT_TOKEN. Add your real bot token to .env before starting Unova Management.');
  process.exit(1);
}

const guildId = process.env.DISCORD_GUILD_ID;
const founderDiscordId = process.env.FOUNDER_DISCORD_ID;
const ticketCategoryId = process.env.DISCORD_TICKET_CATEGORY_ID || process.env.TICKET_CATEGORY_ID;
const ticketCategoryName = process.env.DISCORD_TICKET_CATEGORY_NAME || process.env.TICKET_CATEGORY_NAME || 'tickets';
const configuredBotRoleId = process.env.DISCORD_BOT_ROLE_ID;
const configuredBotUserId = process.env.DISCORD_BOT_USER_ID;
const dashboardUrl = process.env.DASHBOARD_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
const whitelistedRoleId = process.env.WHITELISTED_ROLE_ID;
const businessOwnerRoleId = process.env.BUSINESS_OWNER_ROLE_ID || '1483451364703998005';
const pdRoleId = process.env.PD_ROLE_ID || '1475496342296989696';
const uhsRoleId = process.env.UHS_ROLE_ID;
const bronzePrioRoleId = process.env.BRONZE_PRIO_ROLE_ID || '1475501664080494593';
const silverPrioRoleId = process.env.SILVER_PRIO_ROLE_ID || '1481664036838965339';
const goldPrioRoleId = process.env.GOLD_PRIO_ROLE_ID || '1481664094661644308';
const botDisplayName = process.env.DISCORD_BOT_DISPLAY_NAME || 'Unova Management';
const defaultLogChannelId = '1451550213595467889';
const welcomeChannelId = process.env.DISCORD_WELCOME_CHANNEL_ID || '1450604376505974897';
const whitelistChannelName = process.env.DISCORD_WHITELIST_CHANNEL_NAME || 'whitelist-management';
let whitelistChannelId = process.env.DISCORD_WHITELIST_CHANNEL_ID;
const unovaLogoUrl = 'https://r2.fivemanage.com/O8nsC8f5nKWaQAbWhOnvx/IMG_1324.PNG';
const dashboardPublicUrl = (process.env.DASHBOARD_PUBLIC_URL || dashboardUrl || 'https://unova-founder-dashboard-git-597032418775.europe-west1.run.app')
  .replace(/\/dashboard\/?$/i, '')
  .replace(/\/$/, '');
const unovaWelcomeBannerUrl = `${dashboardPublicUrl}/dashboard/assets/unova-welcome-banner.png`;
const onlineFiveMDiscordIds = new Set();
const vcDmCooldowns = new Map();

if (!guildId || guildId === 'your_discord_server_id') {
  console.warn('DISCORD_GUILD_ID is not configured. Slash commands will not be registered.');
}

if (!process.env.MANAGEMENT_ROLE_ID && !process.env.MANAGEMENT_ROLE_IDS && !process.env.MANAGEMENT_ROLE_NAME && !process.env.MANAGEMENT_ROLE_NAMES) {
  console.warn('MANAGEMENT_ROLE_ID or MANAGEMENT_ROLE_NAME is required for management bot and city permissions.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember,
    Partials.User
  ]
});

const ticketAllow = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks
];
const ticketViewOnly = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory
];
const ticketWriteDeny = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks
];
const rankOrder = ['whitelisted', 'staff', 'senior_staff', 'staff_manager', 'server_manager', 'developer', 'head_developer', 'co_owner', 'owner', 'founder'];
const protectedRankOrder = ['founder', 'owner', 'co_owner', 'head_developer', 'developer', 'server_manager', 'staff_manager', 'senior_staff', 'staff', 'whitelisted'];
const supportTicketLevels = ['staff', 'senior_staff', 'staff_manager', 'server_manager', 'developer', 'head_developer', 'co_owner', 'owner', 'founder'];
const bugTicketLevels = ['developer', 'head_developer', 'co_owner', 'owner', 'founder'];
const ticketLevelLabels = {
  whitelisted: 'Whitelisted',
  staff: 'Staff',
  senior_staff: 'Senior Staff',
  staff_manager: 'Staff Manager',
  server_manager: 'Server Manager',
  developer: 'Developers',
  head_developer: 'Head Developers',
  co_owner: 'Co-Owners',
  owner: 'Owners',
  founder: 'Founder',
};

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

function roleIdsByName(guild, ...nameValues) {
  const names = new Set(nameValues.flatMap(splitConfig).map(normalizeName));
  if (!guild || !names.size) return [];

  return guild.roles.cache
    .filter((role) => names.has(normalizeName(role.name)))
    .map((role) => role.id);
}

function roleGroupIds(guild, group) {
  const groups = {
    management: {
      ids: [process.env.MANAGEMENT_ROLE_ID, process.env.MANAGEMENT_ROLE_IDS, process.env.DISCORD_MANAGEMENT_ROLE_ID],
      names: [process.env.MANAGEMENT_ROLE_NAME, process.env.MANAGEMENT_ROLE_NAMES, 'Management', 'Unova Management']
    },
    whitelisted: {
      ids: [process.env.WHITELISTED_ROLE_ID, process.env.WHITELISTED_ROLE_IDS],
      names: [process.env.WHITELISTED_ROLE_NAME, process.env.WHITELISTED_ROLE_NAMES, 'Whitelisted', 'Allowlisted']
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
  const config = groups[group];
  if (!config) return [];
  return cleanIdList(...config.ids, roleIdsByName(guild, ...config.names).join(','));
}

function leadershipRoleIds(guild) {
  return cleanIdList(
    roleGroupIds(guild, 'co_owner').join(','),
    roleGroupIds(guild, 'owner').join(',')
  );
}

function privilegedOverrideRoleIds(guild) {
  return cleanIdList(
    leadershipRoleIds(guild).join(','),
    roleGroupIds(guild, 'founder').join(',')
  );
}

function managementRoleIds(guild) {
  return roleGroupIds(guild, 'management');
}

function ticketAccessRoleIds(guild) {
  return cleanIdList(
    roleGroupIds(guild, 'management').join(','),
    process.env.TICKET_ACCESS_ROLE_IDS,
    roleIdsByName(guild, process.env.TICKET_ACCESS_ROLE_NAMES).join(',')
  );
}

function banRoleIds(guild) {
  return cleanIdList(
    process.env.DISCORD_BAN_ROLE_ID || process.env.BAN_ROLE_ID,
    roleIdsByName(guild, process.env.DISCORD_BAN_ROLE_NAME || process.env.BAN_ROLE_NAME || 'Banned').join(',')
  );
}

function banRemoveRoleIds(guild) {
  return cleanIdList(
    process.env.DISCORD_BAN_REMOVE_ROLE_IDS || process.env.BAN_REMOVE_ROLE_IDS,
    roleIdsByName(guild, process.env.DISCORD_BAN_REMOVE_ROLE_NAMES || process.env.BAN_REMOVE_ROLE_NAMES).join(',')
  );
}

function memberHasAnyRole(member, roleIds) {
  if (!member || !roleIds.length) return false;

  if (member.roles && member.roles.cache) {
    return roleIds.some((roleId) => member.roles.cache.has(roleId));
  }

  if (Array.isArray(member.roles)) {
    return roleIds.some((roleId) => member.roles.includes(roleId));
  }

  return false;
}

function isManagementMember(member, userId) {
  return memberHasAnyRole(member, managementRoleIds(member?.guild));
}

function isFounderMember(member, userId) {
  const configuredFounderId = cleanId(founderDiscordId);
  if (configuredFounderId && userId === configuredFounderId) return true;
  return memberHasAnyRole(member, roleGroupIds(member?.guild, 'founder'));
}

function isPrivilegedOverrideMember(member, userId) {
  return isFounderMember(member, userId) || memberHasAnyRole(member, privilegedOverrideRoleIds(member?.guild));
}

function memberHasStaffChainAccess(member, userId) {
  if (!member) return false;
  return ['staff', 'senior_staff', 'staff_manager', 'server_manager', 'co_owner', 'owner', 'founder']
    .some((key) => key === 'founder' ? isFounderMember(member, userId) : memberHasAnyRole(member, roleGroupIds(member.guild, key)));
}

function memberHasRoleGrantAccess(member, userId) {
  if (!member) return false;
  return ['staff', 'senior_staff', 'staff_manager', 'server_manager', 'co_owner', 'owner', 'founder']
    .some((key) => key === 'founder' ? isFounderMember(member, userId) : memberHasAnyRole(member, roleGroupIds(member.guild, key)));
}

function memberHasSeniorRoleGrantAccess(member, userId) {
  if (!member) return false;
  return ['server_manager', 'co_owner', 'owner', 'founder']
    .some((key) => key === 'founder' ? isFounderMember(member, userId) : memberHasAnyRole(member, roleGroupIds(member.guild, key)));
}

function leadershipRank(member, userId) {
  if (isFounderMember(member, userId)) return 'founder';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'owner'))) return 'owner';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'co_owner'))) return 'co_owner';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'head_developer'))) return 'head_developer';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'developer'))) return 'developer';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'server_manager'))) return 'server_manager';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'staff_manager'))) return 'staff_manager';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'senior_staff'))) return 'senior_staff';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'staff'))) return 'staff';
  if (memberHasAnyRole(member, roleGroupIds(member?.guild, 'whitelisted'))) return 'whitelisted';
  return 'player';
}

function protectedMentionRoleMap(guild) {
  return [
    ['staff', roleGroupIds(guild, 'staff')],
    ['senior_staff', roleGroupIds(guild, 'senior_staff')],
    ['staff_manager', roleGroupIds(guild, 'staff_manager')],
    ['server_manager', roleGroupIds(guild, 'server_manager')],
    ['co_owner', roleGroupIds(guild, 'co_owner')],
    ['owner', roleGroupIds(guild, 'owner')],
    ['founder', roleGroupIds(guild, 'founder')],
    ['developer', roleGroupIds(guild, 'developer')],
    ['head_developer', roleGroupIds(guild, 'head_developer')]
  ];
}

function rankValue(roleKey) {
  return rankOrder.indexOf(roleKey);
}

function isRankAbove(authorKey, targetKey) {
  return rankValue(authorKey) > rankValue(targetKey);
}

function memberMentionKey(member) {
  if (!member) return null;
  const guild = member.guild;
  return protectedRankOrder.find((key) => {
    if (key === 'founder' && isFounderMember(member, member.id)) return true;
    return memberHasAnyRole(member, roleGroupIds(guild, key));
  }) || null;
}

function memberMentionRank(member) {
  return rankValue(memberMentionKey(member));
}

function canMentionProtected(authorKey, targetKey) {
  if (!targetKey) return true;
  if (!authorKey) return false;
  if (authorKey === 'founder') return true;

  const upwardAllows = {
    owner: ['founder'],
    co_owner: ['owner', 'founder'],
    head_developer: ['co_owner', 'owner', 'founder'],
    developer: ['head_developer', 'co_owner', 'owner'],
    server_manager: ['developer', 'head_developer', 'co_owner', 'owner'],
    staff_manager: ['server_manager', 'developer', 'head_developer', 'co_owner', 'owner'],
    senior_staff: ['staff_manager', 'developer', 'server_manager'],
    staff: ['senior_staff', 'staff_manager'],
    whitelisted: []
  };

  return authorKey === targetKey
    || isRankAbove(authorKey, targetKey)
    || (upwardAllows[authorKey] || []).includes(targetKey);
}

function allowedEscalationTargetsForRank(actorRank, kind) {
  const supportTargets = {
    staff: ['senior_staff', 'staff_manager', 'server_manager', 'developer'],
    senior_staff: ['staff_manager', 'server_manager', 'developer'],
    staff_manager: ['server_manager', 'developer', 'head_developer', 'co_owner', 'owner'],
    server_manager: ['developer', 'head_developer', 'co_owner', 'owner'],
    developer: ['head_developer', 'co_owner', 'owner'],
    head_developer: ['co_owner', 'owner', 'founder'],
    co_owner: ['owner', 'founder'],
    owner: ['founder'],
    founder: supportTicketLevels
  };
  const bugTargets = {
    developer: ['head_developer', 'co_owner', 'owner'],
    head_developer: ['co_owner', 'owner', 'founder'],
    co_owner: ['owner', 'founder'],
    owner: ['founder'],
    founder: bugTicketLevels
  };
  return kind === 'bug'
    ? (bugTargets[actorRank] || [])
    : (supportTargets[actorRank] || []);
}

function allowedDeescalationTargetsForRank(actorRank, kind) {
  const levels = kind === 'bug' ? bugTicketLevels : supportTicketLevels;
  if (actorRank === 'founder') return levels;
  return levels.filter((level) => rankValue(level) < rankValue(actorRank));
}

function isMetagamingExempt(member) {
  if (!member) return false;
  return ['founder', 'owner', 'co_owner', 'developer', 'head_developer'].some((key) => {
    if (key === 'founder' && isFounderMember(member, member.id)) return true;
    return memberHasAnyRole(member, roleGroupIds(member.guild, key));
  });
}

function blockedProtectedMentions(message) {
  const authorKey = memberMentionKey(message.member);
  const blocked = [];
  const mentionedRoleIds = new Set(message.mentions.roles.map((role) => role.id));
  const mentionedUserIds = new Set(message.mentions.users.map((user) => user.id));
  const repliedUserId = message.reference?.messageId ? message.mentions.repliedUser?.id : null;

  for (const [key, roleIds] of protectedMentionRoleMap(message.guild)) {
    if (canMentionProtected(authorKey, key)) continue;

    for (const roleId of roleIds) {
      if (mentionedRoleIds.has(roleId)) blocked.push(`<@&${roleId}>`);
    }
  }

  for (const member of message.mentions.members.values()) {
    if (repliedUserId && member.id === repliedUserId) continue;
    const targetKey = memberMentionKey(member);
    if (targetKey && targetKey !== 'whitelisted' && !canMentionProtected(authorKey, targetKey) && mentionedUserIds.has(member.id)) {
      blocked.push(`<@${member.id}>`);
    }
  }

  return blocked;
}

async function postDashboardInternal(path, body) {
  if (!process.env.FIVEM_API_KEY) return null;
  return axios.post(`${dashboardUrl}${path}`, body, {
    headers: { 'x-api-key': process.env.FIVEM_API_KEY },
    timeout: 5000
  }).catch(() => null);
}

async function getOnlinePlayerByCityId(playerId) {
  const response = await axios.get(`${dashboardUrl}/api/players`, { timeout: 5000 }).catch(() => null);
  const players = response?.data?.players || [];
  return players.find((player) => String(player.id) === String(playerId)) || null;
}

function memberHasRole(member, roleId) {
  if (!roleId || !member) return false;

  if (member.roles && member.roles.cache) {
    return member.roles.cache.has(roleId);
  }

  if (Array.isArray(member.roles)) {
    return member.roles.includes(roleId);
  }

  return false;
}

function channelSafeName(value, fallback = 'ticket') {
  const cleaned = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned || fallback).slice(0, 42);
}

function makeTicketName(label, userOrName) {
  const name = typeof userOrName === 'string' && !/^\d{15,25}$/.test(userOrName)
    ? userOrName
    : (userOrName ? String(userOrName).slice(-6) : Date.now().toString().slice(-6));
  return `${channelSafeName(label)}-${channelSafeName(name)}`.slice(0, 90);
}

function makeUnclaimedTicketName(label, openerName) {
  return `${channelSafeName(label)}-unclaimed-${channelSafeName(openerName)}`.slice(0, 90);
}

function makeClaimedTicketName(openerName, staffName) {
  return `${channelSafeName(openerName)}-claimed-${channelSafeName(staffName)}`.slice(0, 90);
}

function makeAttentionTicketName(openerName, level) {
  return `${channelSafeName(openerName)}-unclaimed-attention-${channelSafeName(ticketLevelLabels[level] || level || 'management')}`.slice(0, 90);
}

function uniqueOverwrites(overwrites) {
  const seen = new Set();
  return overwrites.filter((overwrite) => {
    if (!overwrite.id || seen.has(overwrite.id)) return false;
    seen.add(overwrite.id);
    return true;
  });
}

function buildTicketOverwrites(guild, extraUserIds = []) {
  const botUserId = cleanId(configuredBotUserId) || client.user.id;
  const botRoleId = cleanId(configuredBotRoleId);
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    }
  ];

  for (const roleId of ticketAccessRoleIds(guild)) {
    overwrites.push({ id: roleId, allow: ticketAllow });
  }

  if (botRoleId) {
    overwrites.push({ id: botRoleId, allow: ticketAllow });
  }

  if (botUserId) {
    overwrites.push({ id: botUserId, allow: ticketAllow });
  }

  for (const userId of extraUserIds.map(cleanId).filter(Boolean)) {
    overwrites.push({ id: userId, allow: ticketAllow });
  }

  return uniqueOverwrites(overwrites);
}

function isTicketChannel(channel) {
  return Boolean(channel && channel.topic && channel.topic.includes('unova-management-ticket'));
}

async function resolveTicketCategory(guild) {
  const configuredCategoryId = cleanId(ticketCategoryId);
  if (configuredCategoryId) return configuredCategoryId;

  await guild.channels.fetch().catch(() => null);
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && normalizeName(channel.name) === normalizeName(ticketCategoryName)
  );
  if (existing) return existing.id;

  if (process.env.DISCORD_AUTO_CREATE_TICKET_CATEGORY === 'false') return null;

  const category = await guild.channels.create({
    name: ticketCategoryName,
    type: ChannelType.GuildCategory
  });
  return category.id;
}

async function refreshOnlineFiveMDiscordIds() {
  if (!process.env.FIVEM_API_KEY) return;

  try {
    const response = await axios.get(`${dashboardUrl}/internal/fivem/online-discord-ids`, {
      headers: { 'x-api-key': process.env.FIVEM_API_KEY },
      timeout: 5000
    });
    onlineFiveMDiscordIds.clear();
    for (const discordId of response.data.discordIds || []) {
      const cleanDiscordId = cleanId(discordId);
      if (cleanDiscordId) onlineFiveMDiscordIds.add(cleanDiscordId);
    }
  } catch {
    // The API may not be running while only the bot is being tested.
  }
}

async function dmMetagamingWarning(member) {
  const lastSentAt = vcDmCooldowns.get(member.id) || 0;
  const now = Date.now();
  if (now - lastSentAt < 10 * 60 * 1000) return;
  vcDmCooldowns.set(member.id, now);

  await member.send([
    'You cannot metagame meaning VC and city.',
    'This includes private VC calls.',
    'If you are found to be metagaming, you will receive an official warning.'
  ].join('\n')).catch(() => null);
}

function makeManagementMentionLine(guild) {
  const roleIds = managementRoleIds(guild);
  if (roleIds.length) {
    return `Management role: ${roleIds.map((roleId) => `<@&${roleId}>`).join(', ')}`;
  }
  return 'Management role: not configured';
}

function ticketLevelRoleIds(guild, kind, level) {
  if (kind === 'bug' && level === 'developer') {
    return roleGroupIds(guild, 'developer');
  }

  return roleGroupIds(guild, level);
}

function parseTicketMeta(channel) {
  const topic = channel?.topic || '';
  if (!topic.includes('unova-support-ticket') && !topic.includes('unova-management-ticket')) return null;
  const meta = {};
  for (const part of topic.split('|').map((item) => item.trim())) {
    const [key, ...rest] = part.split('=');
    if (rest.length) meta[key.trim()] = rest.join('=').trim();
  }
  if (topic.includes('unova-management-ticket')) {
    meta.kind = meta.kind || 'management';
    meta.locked = 'true';
  }
  return meta;
}

function serializeTicketMeta(meta) {
  return [
    'unova-support-ticket',
    `kind=${meta.kind || 'support'}`,
    `level=${meta.level || 'staff'}`,
    `opener=${meta.opener || 'unknown'}`,
    `openerRank=${meta.openerRank || 'staff'}`,
    `claimed=${meta.claimed || 'none'}`,
    `source=${meta.source || 'player'}`,
    `locked=${meta.locked === true || meta.locked === 'true' ? 'true' : 'false'}`
  ].join(' | ');
}

function buildSupportTicketOverwrites(guild, openerId, kind, level, openerRank = 'staff') {
  const botUserId = cleanId(configuredBotUserId) || client.user.id;
  const botRoleId = cleanId(configuredBotRoleId);
  const ticketLevel = kind === 'bug' && level === 'developer' ? 'developer' : level;
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    }
  ];

  if (cleanId(openerId)) {
    overwrites.push({ id: openerId, allow: ticketAllow });
  }

  for (const roleId of ticketLevelRoleIds(guild, kind, ticketLevel)) {
    overwrites.push({ id: roleId, allow: ticketAllow });
  }

  for (const key of ['owner', 'founder']) {
    for (const roleId of roleGroupIds(guild, key)) {
      const canTalk = ticketLevel === key;
      overwrites.push(canTalk
        ? { id: roleId, allow: ticketAllow }
        : { id: roleId, allow: ticketViewOnly, deny: ticketWriteDeny });
    }
  }

  if (botRoleId) overwrites.push({ id: botRoleId, allow: ticketAllow });
  if (botUserId) overwrites.push({ id: botUserId, allow: ticketAllow });
  return uniqueOverwrites(overwrites);
}

function roleMentionLine(roleIds) {
  return roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
}

async function roleIdsHaveMembers(guild, roleIds) {
  const cleanRoleIds = cleanIdList(roleIds.join(','));
  if (!cleanRoleIds.length) return false;
  await guild.members.fetch().catch(() => null);
  return cleanRoleIds.some((roleId) => {
    const role = guild.roles.cache.get(roleId);
    return role && role.members.size > 0;
  });
}

async function nearestAvailableTicketLevel(guild, kind, levels, preferredIndex) {
  for (let index = preferredIndex; index < levels.length; index += 1) {
    const level = levels[index];
    if (await roleIdsHaveMembers(guild, ticketLevelRoleIds(guild, kind, level))) return level;
  }
  return levels[levels.length - 1] || null;
}

async function nextAvailableTicketLevel(guild, kind, currentLevel) {
  const levels = kind === 'bug' ? bugTicketLevels : supportTicketLevels;
  const index = levels.indexOf(currentLevel);
  if (index === -1 || index >= levels.length - 1) return null;
  return nearestAvailableTicketLevel(guild, kind, levels, index + 1);
}

async function initialTicketLevel(guild, kind, openerRank) {
  if (kind === 'bug') return nearestAvailableTicketLevel(guild, kind, bugTicketLevels, 0);
  const openerIndex = supportTicketLevels.indexOf(openerRank);
  const preferredIndex = openerIndex >= 0 ? openerIndex + 1 : 0;
  return nearestAvailableTicketLevel(guild, kind, supportTicketLevels, preferredIndex);
}

function ticketStatusEmbed(kind, level, claimedBy = null) {
  return {
    color: 2807784,
    title: claimedBy ? 'Claimed Ticket' : 'Unclaimed Ticket',
    thumbnail: { url: unovaLogoUrl },
    fields: [
      { name: 'Ticket Level', value: ticketLevelLabels[level] || level || 'Unknown', inline: true },
      { name: 'Claimed By', value: claimedBy ? `<@${claimedBy}>` : 'Unclaimed', inline: true }
    ],
    footer: { text: kind === 'bug' ? 'Unova Bug Report' : 'Unova Support' }
  };
}

function ticketButtons(kind, locked) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(kind === 'bug' ? 'ticket_bug_escalate' : 'ticket_escalate')
      .setLabel('Escalate')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(kind === 'bug' ? 'ticket_bug_deescalate' : 'ticket_deescalate')
      .setLabel('De-escalate')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket_override')
      .setLabel('Override')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
  );

  if (kind === 'bug') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_bug_to_staff')
        .setLabel('Send To Staff')
        .setStyle(ButtonStyle.Success)
    );
  }

  return [row];
}

async function escalationOptionsForMember(guild, member, meta) {
  const actorRank = leadershipRank(member, member?.id);
  const levels = meta.kind === 'bug' ? bugTicketLevels : supportTicketLevels;
  const currentIndex = levels.indexOf(meta.level);
  const allowedTargets = allowedEscalationTargetsForRank(actorRank, meta.kind);
  const options = [];

  for (const level of levels) {
    const levelIndex = levels.indexOf(level);
    if (currentIndex !== -1 && levelIndex <= currentIndex) continue;
    if (!allowedTargets.includes(level)) continue;
    if (!await roleIdsHaveMembers(guild, ticketLevelRoleIds(guild, meta.kind, level))) continue;

    options.push({
      label: ticketLevelLabels[level] || level,
      value: level,
      description: `Escalate this ticket to ${ticketLevelLabels[level] || level}`
    });
  }

  return options.slice(0, 25);
}

async function ticketEscalationPanel(guild, member, meta) {
  const options = await escalationOptionsForMember(guild, member, meta);
  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_escalate_select')
      .setPlaceholder('Choose who this ticket needs')
      .addOptions(options)
  );
}

async function deescalationOptionsForMember(member, meta) {
  const actorRank = leadershipRank(member, member?.id);
  const levels = meta.kind === 'bug' ? bugTicketLevels : supportTicketLevels;
  const currentIndex = levels.indexOf(meta.level);
  const allowedTargets = allowedDeescalationTargetsForRank(actorRank, meta.kind);
  const options = [];

  for (const level of levels) {
    const levelIndex = levels.indexOf(level);
    if (currentIndex !== -1 && levelIndex >= currentIndex) continue;
    if (!allowedTargets.includes(level)) continue;

    options.push({
      label: ticketLevelLabels[level] || level,
      value: level,
      description: `De-escalate this ticket to ${ticketLevelLabels[level] || level}`
    });
  }

  return options.slice(0, 25);
}

async function ticketDeescalationPanel(member, meta) {
  const options = await deescalationOptionsForMember(member, meta);
  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_deescalate_select')
      .setPlaceholder('Choose where to move this ticket down')
      .addOptions(options)
  );
}

function playerReportModal() {
  return new ModalBuilder()
    .setCustomId('player_report_modal')
    .setTitle('Player Report')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('offender_id')
          .setLabel('Player ID in city')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('bodycam')
          .setLabel('Bodycam link')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('details')
          .setLabel('What happened?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
}

function pullPlayerModal() {
  return new ModalBuilder()
    .setCustomId('pull_player_modal')
    .setTitle('Pull A Player')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('player_user_id')
          .setLabel('Discord name, username, ID, or mention')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Example: Jack Hodgy, jackhodgyuk, @Jack, or user ID')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pull_reason')
          .setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
}

function roleGrantDefinitions() {
  return [
    { key: 'business_owner', label: 'Business Owner', roleId: businessOwnerRoleId, seniorOnly: false },
    { key: 'pd', label: 'PD', roleId: pdRoleId, seniorOnly: false },
    { key: 'uhs', label: 'UHS', roleId: uhsRoleId, seniorOnly: false },
    { key: 'whitelisted', label: 'Whitelisted', roleId: whitelistedRoleId, seniorOnly: true },
    { key: 'bronze_prio', label: 'Bronze Prio', roleId: bronzePrioRoleId, seniorOnly: true },
    { key: 'silver_prio', label: 'Silver Prio', roleId: silverPrioRoleId, seniorOnly: true },
    { key: 'gold_prio', label: 'Gold Prio', roleId: goldPrioRoleId, seniorOnly: true }
  ].filter((item) => cleanId(item.roleId));
}

function allowedRoleGrantDefinitions(member, userId) {
  const senior = memberHasSeniorRoleGrantAccess(member, userId);
  return roleGrantDefinitions().filter((item) => senior || !item.seniorOnly);
}

function roleGrantByKey(key) {
  return roleGrantDefinitions().find((item) => item.key === key) || null;
}

function roleGrantPanel(member, userId) {
  const options = allowedRoleGrantDefinitions(member, userId).map((item) => ({
    label: item.label,
    value: item.key,
    description: `Give ${item.label} to a Discord user`
  }));

  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('role_grant_select')
      .setPlaceholder('Choose a role to give')
      .addOptions(options)
  );
}

function roleGrantModal(roleKey, label) {
  return new ModalBuilder()
    .setCustomId(`grant_role_modal:${roleKey}`)
    .setTitle(`Give ${label}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('target_user')
          .setLabel('Discord user ID or mention')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

async function createPlayerTicket(guild, opener, kind) {
  const openerMember = await guild.members.fetch(opener.id).catch(() => null);
  const openerRank = leadershipRank(openerMember, opener.id);
  const initialLevel = await initialTicketLevel(guild, kind, openerRank);
  const openerName = openerMember?.displayName || opener.globalName || opener.username || opener.id;
  const channelOptions = {
    name: makeUnclaimedTicketName(kind === 'bug' ? 'bug' : 'support', openerName),
    type: ChannelType.GuildText,
    topic: serializeTicketMeta({
      kind,
      level: initialLevel,
      opener: opener.id,
      openerRank,
      source: 'player',
      locked: false
    }),
    permissionOverwrites: buildSupportTicketOverwrites(guild, opener.id, kind, initialLevel, openerRank)
  };

  const categoryId = await resolveTicketCategory(guild).catch((error) => {
    console.warn(`[Unova Bot] Ticket category lookup failed: ${error.message}`);
    return null;
  });
  if (categoryId) channelOptions.parent = categoryId;

  const channel = await guild.channels.create(channelOptions);
  const notifyRoleIds = ticketLevelRoleIds(guild, kind, initialLevel);
  const mentions = roleMentionLine(notifyRoleIds);
  await channel.send({
    content: [
      mentions || makeManagementMentionLine(guild),
      `**${kind === 'bug' ? 'Bug report' : 'Support ticket'} opened**`,
      `Player: <@${opener.id}> (${opener.id})`,
      `Current level: ${ticketLevelLabels[initialLevel]}`,
      '',
      'Staff should be the first point of call. Use the buttons below when this needs moving up.'
    ].join('\n'),
    embeds: [ticketStatusEmbed(kind, initialLevel)],
    components: ticketButtons(kind, false),
    allowedMentions: { parse: ['roles', 'users'] }
  });
  await postDashboardInternal('/internal/tickets/upsert', {
    id: channel.id,
    channelId: channel.id,
    guildId: guild.id,
    channelName: channel.name,
    kind,
    level: initialLevel,
    openerId: opener.id,
    openerName: opener.tag || opener.username,
    source: 'discord-panel',
    locked: false,
    status: 'open'
  });
  await postDashboardInternal('/internal/city/notify', {
    type: 'ticket',
    message: `New ${kind === 'bug' ? 'bug report' : 'player report'} in Discord: ${channel.name}`
  });
  return channel;
}

function memberCanEscalateTicket(member, meta) {
  if (!member || !meta) return false;
  if (isFounderMember(member, member.id)) return true;
  return memberHasAnyRole(member, ticketLevelRoleIds(member.guild, meta.kind, meta.level));
}

function ticketClaimLevelForMember(member, kind, openerRank) {
  if (!member) return null;
  const rank = leadershipRank(member, member.id);
  const levels = kind === 'bug' ? bugTicketLevels : supportTicketLevels;
  if (!levels.includes(rank)) return null;
  if (rankValue(rank) <= rankValue(openerRank)) return null;
  return rank;
}

async function claimTicketIfNeeded(message) {
  const meta = parseTicketMeta(message.channel);
  if (!meta || meta.kind === 'management' || (meta.claimed && meta.claimed !== 'none')) return;
  if (message.author.id === meta.opener) return;

  const claimLevel = ticketClaimLevelForMember(message.member, meta.kind, meta.openerRank || 'player');
  if (!claimLevel) return;

  const nextMeta = { ...meta, level: claimLevel, claimed: message.author.id };
  await message.channel.setTopic(serializeTicketMeta(nextMeta)).catch(() => null);
  await message.channel.permissionOverwrites.set(
    buildSupportTicketOverwrites(message.guild, meta.opener, meta.kind, claimLevel, meta.openerRank)
  ).catch(() => null);
  const opener = meta.opener ? await message.guild.members.fetch(meta.opener).catch(() => null) : null;
  const openerName = opener?.displayName || meta.opener || 'ticket';
  const staffName = message.member?.displayName || message.author.username;
  await message.channel.setName(makeClaimedTicketName(openerName, staffName)).catch(() => null);
  await message.channel.send({
    content: `Ticket claimed by <@${message.author.id}> at ${ticketLevelLabels[claimLevel] || claimLevel}.`,
    embeds: [ticketStatusEmbed(meta.kind, claimLevel, message.author.id)],
    allowedMentions: { users: [message.author.id], roles: [] }
  }).catch(() => null);
  await postDashboardInternal('/internal/tickets/upsert', {
    id: message.channel.id,
    channelId: message.channel.id,
    guildId: message.guild.id,
    channelName: message.channel.name,
    kind: meta.kind,
    level: claimLevel,
    openerId: meta.opener,
    source: meta.source || 'discord',
    locked: meta.locked === 'true',
    status: 'open'
  });
  await logToStaff(`Ticket claimed: <#${message.channel.id}> by <@${message.author.id}> at ${ticketLevelLabels[claimLevel] || claimLevel}.`);
}

function higherManagementAttentionEmbed(nextLevel, actor) {
  return {
    color: 15158332,
    title: 'Higher Management Attention Required',
    description: [
      'This ticket requires attention from higher ranking members of Unova Management please.',
      '',
      `Escalated by <@${actor.id}>.`,
      `Current level: **${ticketLevelLabels[nextLevel] || nextLevel}**.`
    ].join('\n'),
    footer: { text: 'Unova Ticket Escalation' },
    timestamp: new Date().toISOString()
  };
}

async function moveTicketLevel(channel, meta, nextLevel, actor, nextKind = meta.kind, options = {}) {
  const releaseClaim = options.releaseClaim === true;
  const nextMeta = { ...meta, kind: nextKind, level: nextLevel };
  if (releaseClaim) nextMeta.claimed = 'none';
  if (options.claimedBy) nextMeta.claimed = options.claimedBy;
  await channel.setTopic(serializeTicketMeta(nextMeta));
  await channel.permissionOverwrites.set(
    buildSupportTicketOverwrites(channel.guild, meta.opener, nextKind, nextLevel, meta.openerRank)
  );

  const roleIds = ticketLevelRoleIds(channel.guild, nextKind, nextLevel);
  const mentions = roleMentionLine(roleIds);
  const statusClaimedBy = releaseClaim
    ? null
    : options.claimedBy || (meta.claimed && meta.claimed !== 'none' ? meta.claimed : null);
  await channel.send({
    content: [
      mentions,
      options.actionText || `Ticket escalated by <@${actor.id}>.`,
      `Current level: ${ticketLevelLabels[nextLevel] || nextLevel}.`
    ].filter(Boolean).join('\n'),
    embeds: [
      ...(options.attentionEmbed ? [options.attentionEmbed] : []),
      ticketStatusEmbed(nextKind, nextLevel, statusClaimedBy)
    ],
    components: ticketButtons(nextKind, meta.locked === 'true'),
    allowedMentions: { parse: ['roles', 'users'] }
  });

  if (releaseClaim || options.claimedBy) {
    const opener = meta.opener ? await channel.guild.members.fetch(meta.opener).catch(() => null) : null;
    const openerName = opener?.displayName || meta.opener || 'ticket';
    if (options.claimedBy) {
      const claimant = await channel.guild.members.fetch(options.claimedBy).catch(() => null);
      const staffName = claimant?.displayName || actor.username || actor.id;
      await channel.setName(makeClaimedTicketName(openerName, staffName)).catch(() => null);
    } else {
      await channel.setName(makeAttentionTicketName(openerName, nextLevel)).catch(() => null);
    }
  }

  await postDashboardInternal('/internal/tickets/upsert', {
    id: channel.id,
    channelId: channel.id,
    guildId: channel.guild.id,
    channelName: channel.name,
    kind: nextKind,
    level: nextLevel,
    openerId: meta.opener,
    source: meta.source || 'discord',
    locked: meta.locked === 'true',
    status: 'open'
  });
}

async function handleTicketEscalation(interaction, forcedLevel = null) {
  const meta = parseTicketMeta(interaction.channel);
  if (!meta || meta.kind === 'management') {
    return interaction.reply({ content: 'This is not an escalatable player ticket.', flags: MessageFlags.Ephemeral });
  }

  if (!memberCanEscalateTicket(interaction.member, meta)) {
    return interaction.reply({ content: 'Your current role cannot escalate this ticket.', flags: MessageFlags.Ephemeral });
  }

  if (!forcedLevel) {
    const panel = await ticketEscalationPanel(interaction.guild, interaction.member, meta);
    if (!panel) {
      return interaction.reply({ content: 'There are no available escalation options for your role right now.', flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({
      content: 'Choose who this ticket needs attention from.',
      components: [panel],
      flags: MessageFlags.Ephemeral
    });
  }

  const nextLevel = forcedLevel || await nextAvailableTicketLevel(interaction.guild, meta.kind, meta.level);
  if (!nextLevel) {
    return interaction.reply({ content: 'This ticket is already at the highest level.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const nextKind = forcedLevel === 'staff' ? 'support' : meta.kind;
  const actorRank = leadershipRank(interaction.member, interaction.user.id);
  const staffEscalation = !forcedLevel && meta.kind === 'support' && actorRank === 'staff';
  await moveTicketLevel(interaction.channel, meta, nextLevel, interaction.user, nextKind, {
    releaseClaim: staffEscalation,
    attentionEmbed: staffEscalation ? higherManagementAttentionEmbed(nextLevel, interaction.user) : null
  });
  return interaction.editReply(`Escalated to ${ticketLevelLabels[nextLevel] || nextLevel}.`);
}

async function handleTicketEscalationSelection(interaction) {
  const meta = parseTicketMeta(interaction.channel);
  if (!meta || meta.kind === 'management') {
    return interaction.reply({ content: 'This is not an escalatable player ticket.', flags: MessageFlags.Ephemeral });
  }

  if (!memberCanEscalateTicket(interaction.member, meta)) {
    return interaction.reply({ content: 'Your current role cannot escalate this ticket.', flags: MessageFlags.Ephemeral });
  }

  const nextLevel = interaction.values[0];
  const availableOptions = await escalationOptionsForMember(interaction.guild, interaction.member, meta);
  if (!availableOptions.some((option) => option.value === nextLevel)) {
    return interaction.reply({ content: 'That escalation option is not available for your role.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actorRank = leadershipRank(interaction.member, interaction.user.id);
  const staffEscalation = meta.kind === 'support' && actorRank === 'staff';
  await moveTicketLevel(interaction.channel, meta, nextLevel, interaction.user, meta.kind, {
    releaseClaim: staffEscalation,
    attentionEmbed: staffEscalation ? higherManagementAttentionEmbed(nextLevel, interaction.user) : null
  });
  return interaction.editReply(`Escalated to ${ticketLevelLabels[nextLevel] || nextLevel}.`);
}

async function handleTicketDeescalation(interaction) {
  const meta = parseTicketMeta(interaction.channel);
  if (!meta || meta.kind === 'management') {
    return interaction.reply({ content: 'This is not a de-escalatable player ticket.', flags: MessageFlags.Ephemeral });
  }

  if (!memberCanEscalateTicket(interaction.member, meta)) {
    return interaction.reply({ content: 'Your current role cannot de-escalate this ticket.', flags: MessageFlags.Ephemeral });
  }

  const panel = await ticketDeescalationPanel(interaction.member, meta);
  if (!panel) {
    return interaction.reply({ content: 'There are no available de-escalation options for your role right now.', flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    content: 'Choose where this ticket should be moved down to.',
    components: [panel],
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketDeescalationSelection(interaction) {
  const meta = parseTicketMeta(interaction.channel);
  if (!meta || meta.kind === 'management') {
    return interaction.reply({ content: 'This is not a de-escalatable player ticket.', flags: MessageFlags.Ephemeral });
  }

  if (!memberCanEscalateTicket(interaction.member, meta)) {
    return interaction.reply({ content: 'Your current role cannot de-escalate this ticket.', flags: MessageFlags.Ephemeral });
  }

  const previousLevel = interaction.values[0];
  const availableOptions = await deescalationOptionsForMember(interaction.member, meta);
  if (!availableOptions.some((option) => option.value === previousLevel)) {
    return interaction.reply({ content: 'That de-escalation option is not available for your role.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await moveTicketLevel(interaction.channel, meta, previousLevel, interaction.user, meta.kind, {
    releaseClaim: true,
    actionText: `Ticket de-escalated by <@${interaction.user.id}> and marked unclaimed.`
  });
  return interaction.editReply(`De-escalated to ${ticketLevelLabels[previousLevel] || previousLevel}.`);
}

async function handleTicketOverride(interaction) {
  const meta = parseTicketMeta(interaction.channel);
  if (!meta) {
    return interaction.reply({ content: 'This is not a Unova ticket.', flags: MessageFlags.Ephemeral });
  }

  if (meta.source === 'founder' || meta.openerRank === 'founder') {
    return interaction.reply({ content: 'Founder tickets cannot be overridden by anyone.', flags: MessageFlags.Ephemeral });
  }

  const locked = meta.locked === 'true' || meta.source === 'founder' || meta.source === 'fivem-ui';
  const founder = isFounderMember(interaction.member, interaction.user.id);
  if (locked && !founder) {
    return interaction.reply({ content: 'Only the founder can override this locked ticket.', flags: MessageFlags.Ephemeral });
  }

  if (!founder && !isPrivilegedOverrideMember(interaction.member, interaction.user.id)) {
    return interaction.reply({ content: 'Only co-owners, owners, or the founder can override tickets.', flags: MessageFlags.Ephemeral });
  }

  if (meta.kind && meta.kind !== 'management') {
    const overrideLevel = leadershipRank(interaction.member, interaction.user.id);
    const levels = meta.kind === 'bug' ? bugTicketLevels : supportTicketLevels;
    if (!levels.includes(overrideLevel)) {
      return interaction.reply({ content: 'Your role cannot set a ticket level.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await moveTicketLevel(interaction.channel, meta, overrideLevel, interaction.user, meta.kind, {
      claimedBy: interaction.user.id,
      actionText: `Ticket overridden by <@${interaction.user.id}>.`
    });
    return interaction.editReply(`Override granted. Ticket is now at ${ticketLevelLabels[overrideLevel] || overrideLevel}.`);
  }

  await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true
  });
  await interaction.reply({ content: `Override granted to ${interaction.user}.` });
}

async function createManagementTicket(guild, options) {
  const targetUser = options.targetUser || null;
  const reason = options.reason || 'No reason provided';
  const label = options.label || 'ticket';
  const extraUserIds = targetUser ? [targetUser.id] : [];
  const targetMember = targetUser ? await guild.members.fetch(targetUser.id).catch(() => null) : null;
  const targetName = targetMember?.displayName || targetUser?.globalName || targetUser?.username || targetUser?.id;
  const channelOptions = {
    name: makeTicketName(label, targetName),
    type: ChannelType.GuildText,
    topic: `unova-management-ticket | source=${options.source || 'discord'} | target=${targetUser ? targetUser.id : 'none'}`,
    permissionOverwrites: buildTicketOverwrites(guild, extraUserIds)
  };

  const categoryId = await resolveTicketCategory(guild).catch((error) => {
    console.warn(`[Unova Bot] Ticket category lookup failed: ${error.message}`);
    return null;
  });
  if (categoryId) {
    channelOptions.parent = categoryId;
  }

  const channel = await guild.channels.create(channelOptions);
  const targetLine = targetUser ? `Target: <@${targetUser.id}> (${targetUser.id})` : 'Target: not added yet';

  await channel.send([
    '**Management ticket opened**',
    makeManagementMentionLine(guild),
    targetLine,
    `Reason: ${reason}`,
    '',
    'Use `/add` in this channel to add another Discord user.'
  ].join('\n'));

  await postDashboardInternal('/internal/tickets/upsert', {
    id: channel.id,
    channelId: channel.id,
    guildId: guild.id,
    channelName: channel.name,
    kind: 'management',
    level: 'management',
    openerId: options.openerId,
    openerName: options.openerName,
    targetId: targetUser && targetUser.id,
    targetName: targetUser && targetUser.tag,
    source: options.source || 'discord',
    locked: true,
    status: 'open'
  });

  return channel;
}

async function registerSlashCommands(readyClient) {
  if (!cleanId(guildId)) return;

  const guild = await readyClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.warn(`Could not fetch Discord guild ${guildId}. Is the bot invited?`);
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('add')
      .setDescription('Add a Discord user to the current management ticket.')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to add to this ticket.').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a Discord user from the current management ticket.')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to remove from this ticket.').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('whitelist')
      .setDescription('Open the role management dropdown panel.')
      .addStringOption((option) =>
        option.setName('user_id').setDescription('Optional Discord user ID or mention for legacy whitelist grant.').setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Founder-only ticket panel controls.')
      .addSubcommand((subcommand) =>
        subcommand.setName('tickets').setDescription('Post the public support and bug report ticket panel.')
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('whitelist').setDescription('Post the whitelist and role management dropdown panel.')
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('settings').setDescription('Show the current ticket role settings.')
      ),
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Manage private management tickets.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('open')
          .setDescription('Open a private management ticket for a user.')
          .addUserOption((option) =>
            option.setName('user').setDescription('User to add to the ticket.').setRequired(true)
          )
          .addStringOption((option) =>
            option.setName('reason').setDescription('Ticket reason.').setRequired(false)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('close').setDescription('Close the current management ticket.')
      )
  ].map((command) => command.toJSON());

  await guild.commands.set(commands);
  console.log(`[Unova Bot] Registered management slash commands in ${guild.name}.`);
}

async function logToStaff(message) {
  const channelId = cleanId(process.env.DISCORD_LOG_CHANNEL_ID) || defaultLogChannelId;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel) channel.send(String(message).slice(0, 1900)).catch(() => {});
}

function compactLogText(value, limit = 800) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text || '[empty]';
}

function extractDiscordId(value) {
  return cleanId(String(value || '').match(/\d{15,25}/)?.[0]);
}

function normalizeMemberSearch(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function memberSearchFields(member) {
  return [
    member.displayName,
    member.nickname,
    member.user?.globalName,
    member.user?.username,
    member.user?.tag
  ].filter(Boolean);
}

function memberMatchesSearch(member, query) {
  const normalizedQuery = normalizeMemberSearch(query);
  return memberSearchFields(member).some((field) => normalizeMemberSearch(field) === normalizedQuery);
}

async function resolveGuildMemberInput(guild, value) {
  const raw = String(value || '').trim();
  const userId = extractDiscordId(raw);
  if (userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    return member ? { member, ambiguous: false, matches: [member] } : { member: null, ambiguous: false, matches: [] };
  }

  const query = normalizeMemberSearch(raw);
  if (query.length < 2) return { member: null, ambiguous: false, matches: [] };

  const fetched = await guild.members.search({ query: raw, limit: 10 }).catch(() => null);
  const candidates = fetched ? [...fetched.values()] : [];
  const exact = candidates.filter((member) => memberMatchesSearch(member, raw));
  const matches = exact.length ? exact : candidates;

  if (matches.length === 1) return { member: matches[0], ambiguous: false, matches };
  if (matches.length > 1) return { member: null, ambiguous: true, matches };
  return { member: null, ambiguous: false, matches: [] };
}

async function applyDiscordBanRole(member, reason) {
  const addedRoleIds = banRoleIds(member.guild);
  const removedRoleIds = banRemoveRoleIds(member.guild);
  if (!addedRoleIds.length && !removedRoleIds.length) {
    return { ok: false, message: 'No ban role or role-removal config is set.' };
  }

  if (!member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, message: 'Bot missing Manage Roles.' };
  }

  if (removedRoleIds.length) {
    await member.roles.remove(removedRoleIds, reason).catch((error) => {
      throw new Error(`Failed to remove roles: ${error.message}`);
    });
  }

  if (addedRoleIds.length) {
    await member.roles.add(addedRoleIds, reason).catch((error) => {
      throw new Error(`Failed to add ban role: ${error.message}`);
    });
  }

  return { ok: true, addedRoleIds, removedRoleIds };
}

async function grantWhitelistedRole(guild, userId, reason) {
  const roleId = cleanId(whitelistedRoleId);
  if (!roleId) {
    throw new Error('WHITELISTED_ROLE_ID is not configured.');
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    throw new Error('That user is not in this Discord server.');
  }

  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error('Bot missing Manage Roles.');
  }

  await member.roles.add(roleId, reason);
  return member;
}

function isWhitelistChannel(channel) {
  if (!channel) return false;
  if (cleanId(whitelistChannelId) && channel.id === whitelistChannelId) return true;
  return normalizeName(channel.name) === normalizeName(whitelistChannelName);
}

async function ensureWhitelistChannel(guild) {
  if (!cleanId(whitelistedRoleId)) return null;

  const configuredChannelId = cleanId(whitelistChannelId);
  if (configuredChannelId) {
    const configuredChannel = await guild.channels.fetch(configuredChannelId).catch(() => null);
    if (configuredChannel) return configuredChannel;
  }

  await guild.channels.fetch().catch(() => null);
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText && normalizeName(channel.name) === normalizeName(whitelistChannelName)
  );
  if (existing) {
    whitelistChannelId = existing.id;
    return existing;
  }

  const channel = await guild.channels.create({
    name: whitelistChannelName,
    type: ChannelType.GuildText,
    topic: 'Send a Discord user ID here to give that user the whitelisted role.',
    permissionOverwrites: buildTicketOverwrites(guild)
  });
  whitelistChannelId = channel.id;
  return channel;
}

function isOldWelcomeMessage(message, memberId) {
  if (!client.user || message.author?.id !== client.user.id) return false;
  if (memberId && !message.content.includes(`<@${memberId}>`)) return false;

  return message.embeds.some((embed) => {
    const title = embed.title || '';
    const description = embed.description || '';
    const imageUrl = embed.image?.url || '';
    return title === 'Welcome To Unova Roleplay'
      || title === 'Welcome To Unova'
      || imageUrl === unovaLogoUrl
      || embed.fields?.some((field) => field.name === 'Start Here' || field.name === 'Support')
      || description.includes('Welcome ')
      && description.includes(' to the city.')
      && description.includes('Discord metagaming');
  });
}

async function cleanupOldWelcomeMessages(channel, memberId, excludeMessageId = null) {
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!messages) return;

  await Promise.all(messages.map(async (message) => {
    if (excludeMessageId && message.id === excludeMessageId) return;
    if (!isOldWelcomeMessage(message, memberId)) return;
    await message.delete().catch(() => null);
  }));
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[Unova Bot] Logged in as ${readyClient.user.tag}`);
  if (readyClient.user.username !== botDisplayName) {
    await readyClient.user.setUsername(botDisplayName).catch((error) => {
      console.warn(`[Unova Bot] Could not update bot username: ${error.message}`);
    });
  }
  readyClient.user.setActivity('Unova Management');
  await refreshOnlineFiveMDiscordIds();
  setInterval(refreshOnlineFiveMDiscordIds, 10000);
  await registerSlashCommands(readyClient).catch((error) => {
    console.error(`[Unova Bot] Slash command registration failed: ${error.message}`);
  });
  const guild = cleanId(guildId) ? await readyClient.guilds.fetch(guildId).catch(() => null) : null;
  if (guild) {
    await ensureWhitelistChannel(guild).catch((error) => {
      console.warn(`[Unova Bot] Whitelist channel setup failed: ${error.message}`);
    });
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (cleanId(guildId) && member.guild.id !== cleanId(guildId)) return;
  const channel = await member.guild.channels.fetch(cleanId(welcomeChannelId)).catch(() => null);
  if (!channel) return;

  const memberCount = member.guild.memberCount || 'new';
  const memberLabel = typeof memberCount === 'number' ? `#${memberCount}` : memberCount;

  await cleanupOldWelcomeMessages(channel, member.id);

  const sent = await channel.send({
    content: `Welcome ${member} to **Unova Roleplay | UNC**! You are member ${memberLabel}.`,
    embeds: [{
      color: 2807784,
      image: { url: unovaWelcomeBannerUrl }
    }],
    allowedMentions: { users: [member.id], roles: [] }
  }).catch((error) => {
    console.warn(`[Unova Bot] Welcome message failed: ${error.message}`);
  });

  if (sent) {
    setTimeout(() => cleanupOldWelcomeMessages(channel, member.id, sent.id), 3000);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!cleanId(welcomeChannelId) || message.channelId !== cleanId(welcomeChannelId)) return;
  if (!isOldWelcomeMessage(message)) return;
  await message.delete().catch(() => null);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!newState.channelId || oldState.channelId === newState.channelId) return;
  if (!cleanId(whitelistedRoleId)) return;

  const member = newState.member;
  if (!member || member.user.bot) return;
  if (!memberHasRole(member, whitelistedRoleId)) return;
  if (isMetagamingExempt(member)) return;
  if (!onlineFiveMDiscordIds.has(member.id)) return;

  await newState.disconnect('Whitelisted player is in FiveM city and cannot use Discord VC.').catch(() => null);
  await dmMetagamingWarning(member);
  await logToStaff(`Metagaming VC blocked: <@${member.id}> was disconnected from <#${newState.channelId}> while active in city.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'open_support_ticket' || interaction.customId === 'open_bug_ticket') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const kind = interaction.customId === 'open_bug_ticket' ? 'bug' : 'support';
      const channel = await createPlayerTicket(interaction.guild, interaction.user, kind);
      return interaction.editReply(`Ticket opened: ${channel}`);
    }

    if (interaction.customId === 'open_player_report') {
      return interaction.showModal(playerReportModal());
    }

    if (interaction.customId === 'pull_player_ticket') {
      if (!memberHasStaffChainAccess(interaction.member, interaction.user.id)) {
        return interaction.reply({ content: 'Staff and above only.', flags: MessageFlags.Ephemeral });
      }
      return interaction.showModal(pullPlayerModal());
    }

    if (interaction.customId === 'ticket_escalate' || interaction.customId === 'ticket_bug_escalate') {
      return handleTicketEscalation(interaction);
    }

    if (interaction.customId === 'ticket_deescalate' || interaction.customId === 'ticket_bug_deescalate') {
      return handleTicketDeescalation(interaction);
    }

    if (interaction.customId === 'ticket_bug_to_staff') {
      return handleTicketEscalation(interaction, 'staff');
    }

    if (interaction.customId === 'ticket_override') {
      return handleTicketOverride(interaction);
    }

    if (interaction.customId === 'ticket_close') {
      const meta = parseTicketMeta(interaction.channel);
      if (!meta) return interaction.reply({ content: 'This is not a Unova ticket.', flags: MessageFlags.Ephemeral });
      const canClose = isPrivilegedOverrideMember(interaction.member, interaction.user.id)
        || memberCanEscalateTicket(interaction.member, meta)
        || interaction.user.id === meta.opener;
      if (!canClose) {
        return interaction.reply({ content: 'You cannot close this ticket.', flags: MessageFlags.Ephemeral });
      }
      await interaction.reply({ content: 'Closing this ticket.', flags: MessageFlags.Ephemeral });
      await postDashboardInternal('/internal/tickets/close', { channelId: interaction.channel.id });
      await interaction.channel.delete('Ticket closed.');
      return;
    }

    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_escalate_select') {
    return handleTicketEscalationSelection(interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_deescalate_select') {
    return handleTicketDeescalationSelection(interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'role_grant_select') {
    if (!memberHasRoleGrantAccess(interaction.member, interaction.user.id)) {
      return interaction.reply({ content: 'Staff and above only.', flags: MessageFlags.Ephemeral });
    }

    const roleKey = interaction.values[0];
    const role = roleGrantByKey(roleKey);
    if (!role) return interaction.reply({ content: 'That role is not configured.', flags: MessageFlags.Ephemeral });
    if (role.seniorOnly && !memberHasSeniorRoleGrantAccess(interaction.member, interaction.user.id)) {
      return interaction.reply({ content: 'Only server manager, co-owner, owner, or founder can give that role.', flags: MessageFlags.Ephemeral });
    }

    return interaction.showModal(roleGrantModal(role.key, role.label));
  }

  if (interaction.isModalSubmit() && interaction.customId === 'player_report_modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const offenderId = interaction.fields.getTextInputValue('offender_id');
    const bodycam = interaction.fields.getTextInputValue('bodycam');
    const details = interaction.fields.getTextInputValue('details');
    const offender = await getOnlinePlayerByCityId(offenderId);
    const channel = await createPlayerTicket(interaction.guild, interaction.user, 'support');
    await channel.send({
      content: [
        '**Player report details**',
        `Reporter: <@${interaction.user.id}> (${interaction.user.id})`,
        `Possible offender: ${offender?.name || 'unknown'} | City ID: ${offenderId}${offender?.discordId ? ` | <@${offender.discordId}>` : ''}`,
        `Bodycam: ${bodycam}`,
        '',
        details
      ].join('\n'),
      allowedMentions: { parse: ['users'] }
    });
    await postDashboardInternal('/internal/tickets/upsert', {
      id: channel.id,
      channelId: channel.id,
      guildId: interaction.guild.id,
      channelName: channel.name,
      kind: 'player_report',
      level: 'staff',
      openerId: interaction.user.id,
      openerName: interaction.user.tag || interaction.user.username,
      targetId: offender?.discordId,
      targetName: offender?.name || `City ID ${offenderId}`,
      source: 'discord-panel',
      locked: false,
      status: 'open'
    });
    return interaction.editReply(`Player report opened: ${channel}`);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'pull_player_modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!memberHasStaffChainAccess(interaction.member, interaction.user.id)) {
      return interaction.editReply('Staff and above only.');
    }

    const playerSearch = interaction.fields.getTextInputValue('player_user_id');
    const reason = interaction.fields.getTextInputValue('pull_reason');
    const resolved = await resolveGuildMemberInput(interaction.guild, playerSearch);
    if (resolved.ambiguous) {
      const names = resolved.matches
        .slice(0, 5)
        .map((member) => `${member.displayName} (${member.user.username})`)
        .join(', ');
      return interaction.editReply(`I found more than one match: ${names}. Try their exact username, mention, or Discord ID.`);
    }
    if (!resolved.member) return interaction.editReply('Could not find that Discord member. Try their exact username, display name, mention, or Discord ID.');

    const targetUser = resolved.member.user;

    const channel = await createManagementTicket(interaction.guild, {
      targetUser,
      reason,
      label: 'pull',
      source: 'staff-panel',
      openerId: interaction.user.id,
      openerName: interaction.user.tag
    });
    return interaction.editReply(`Player pulled into ticket: ${channel}`);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('grant_role_modal:')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!memberHasRoleGrantAccess(interaction.member, interaction.user.id)) {
      return interaction.editReply('Staff and above only.');
    }

    const roleKey = interaction.customId.split(':')[1];
    const role = roleGrantByKey(roleKey);
    if (!role) return interaction.editReply('That role is not configured.');
    if (role.seniorOnly && !memberHasSeniorRoleGrantAccess(interaction.member, interaction.user.id)) {
      return interaction.editReply('Only server manager, co-owner, owner, or founder can give that role.');
    }

    const userId = extractDiscordId(interaction.fields.getTextInputValue('target_user'));
    if (!userId) return interaction.editReply('Send a valid Discord user ID or mention.');

    try {
      const member = await interaction.guild.members.fetch(userId);
      await member.roles.add(role.roleId, `${role.label} granted by ${interaction.user.tag}`);
      await logToStaff(`Role granted: <@${userId}> received <@&${role.roleId}> from <@${interaction.user.id}>.`);
      return interaction.editReply(`Gave ${role.label} to ${member.user.tag}.`);
    } catch (error) {
      return interaction.editReply(`Role grant failed: ${error.message}`);
    }
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== 'panel' && !isManagementMember(interaction.member, interaction.user.id)) {
    return interaction.reply({ content: 'Management only.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'ticket') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'open') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Management ticket';
      const channel = await createManagementTicket(interaction.guild, {
        targetUser: user,
        reason,
        label: 'ticket',
        source: 'slash-command',
        openerId: interaction.user.id,
        openerName: interaction.user.tag
      });
      return interaction.editReply(`Ticket opened: ${channel}`);
    }

    if (subcommand === 'close') {
      if (!isTicketChannel(interaction.channel)) {
        return interaction.reply({ content: 'Use this inside a management ticket channel.', flags: MessageFlags.Ephemeral });
      }

      await interaction.reply({ content: 'Closing this management ticket.', flags: MessageFlags.Ephemeral });
      await postDashboardInternal('/internal/tickets/close', { channelId: interaction.channel.id });
      await interaction.channel.delete('Management ticket closed.');
      return;
    }
  }

  if (interaction.commandName === 'panel') {
    if (!isFounderMember(interaction.member, interaction.user.id)) {
      return interaction.reply({ content: 'Founder settings only.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'tickets') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_support_ticket')
          .setLabel('Open Support Ticket')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('open_bug_ticket')
          .setLabel('Bug Report')
          .setStyle(ButtonStyle.Secondary)
        ,
        new ButtonBuilder()
          .setCustomId('open_player_report')
          .setLabel('Player Report')
          .setStyle(ButtonStyle.Success)
        ,
        new ButtonBuilder()
          .setCustomId('pull_player_ticket')
          .setLabel('Pull A Player')
          .setStyle(ButtonStyle.Danger)
      );
      await interaction.channel.send({
        content: [
          '**Unova Support**',
          'Open a support ticket, player report, or bug report.'
        ].join('\n'),
        embeds: [{
          color: 2807784,
          thumbnail: { url: unovaLogoUrl },
          footer: { text: 'Unova Roleplay' }
        }],
        components: [row]
      });
      return interaction.reply({ content: 'Ticket panel posted.', flags: MessageFlags.Ephemeral });
    }

    if (subcommand === 'whitelist') {
      const row = roleGrantPanel(interaction.member, interaction.user.id);
      if (!row) {
        return interaction.reply({ content: 'No role grant options are configured for your rank.', flags: MessageFlags.Ephemeral });
      }

      await interaction.channel.send({
        content: [
          '**Unova Role Management**',
          'Choose a role from the dropdown, then enter the Discord user ID or mention.'
        ].join('\n'),
        components: [row]
      });
      return interaction.reply({ content: 'Role management panel posted.', flags: MessageFlags.Ephemeral });
    }

    if (subcommand === 'settings') {
      const lines = [
        '**Ticket Settings**',
        `Management: ${managementRoleIds(interaction.guild).map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Staff: ${roleGroupIds(interaction.guild, 'staff').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Senior Staff: ${roleGroupIds(interaction.guild, 'senior_staff').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Staff Manager: ${roleGroupIds(interaction.guild, 'staff_manager').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Server Manager: ${roleGroupIds(interaction.guild, 'server_manager').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Co-Owner: ${roleGroupIds(interaction.guild, 'co_owner').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Owner: ${roleGroupIds(interaction.guild, 'owner').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Founder: ${roleGroupIds(interaction.guild, 'founder').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Developer: ${roleGroupIds(interaction.guild, 'developer').map((id) => `<@&${id}>`).join(', ') || 'not set'}`,
        `Head Developer: ${roleGroupIds(interaction.guild, 'head_developer').map((id) => `<@&${id}>`).join(', ') || 'not set'}`
      ];
      return interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.commandName === 'whitelist') {
    if (!memberHasRoleGrantAccess(interaction.member, interaction.user.id)) {
      return interaction.reply({ content: 'Staff and above only.', flags: MessageFlags.Ephemeral });
    }

    const userId = extractDiscordId(interaction.options.getString('user_id', false));
    if (userId) {
      if (!memberHasSeniorRoleGrantAccess(interaction.member, interaction.user.id)) {
        return interaction.reply({ content: 'Only server manager, co-owner, owner, or founder can give whitelisted.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const member = await grantWhitelistedRole(interaction.guild, userId, `Whitelisted by ${interaction.user.tag}`);
        return interaction.editReply(`Whitelisted ${member.user.tag}.`);
      } catch (error) {
        return interaction.editReply(`Whitelist failed: ${error.message}`);
      }
    }

    const row = roleGrantPanel(interaction.member, interaction.user.id);
    if (!row) return interaction.reply({ content: 'No role grant options are configured for your rank.', flags: MessageFlags.Ephemeral });
    return interaction.reply({
      content: 'Choose a role, then enter the Discord user ID or mention.',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.commandName === 'add') {
    if (!isTicketChannel(interaction.channel)) {
      return interaction.reply({ content: 'Use `/add` inside a management ticket channel.', flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user', true);
    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });
    await interaction.reply({ content: `Added ${user} to this management ticket.` });
    return;
  }

  if (interaction.commandName === 'remove') {
    if (!isTicketChannel(interaction.channel)) {
      return interaction.reply({ content: 'Use `/remove` inside a management ticket channel.', flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user', true);
    await interaction.channel.permissionOverwrites.delete(user.id).catch(() => null);
    await interaction.reply({ content: `Removed ${user} from this management ticket.` });
  }
});

// Lightweight text-command fallback. Main moderation should come from the FiveM UI/API.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const blockedMentions = blockedProtectedMentions(message);
  if (blockedMentions.length) {
    await message.delete().catch(() => null);
    await message.member.timeout(30000, 'Tagged protected staff above their level.').catch(() => null);
    await message.channel.send({
      content: `${message.author}, you cannot tag protected staff roles or users above your level. You have been timed out for 30 seconds.`,
      allowedMentions: { users: [message.author.id], roles: [] }
    }).catch(() => null);
    await logToStaff(`Protected mention blocked from <@${message.author.id}> in <#${message.channel.id}>: ${blockedMentions.join(', ')}`);
    return;
  }

  await claimTicketIfNeeded(message);

  if (isWhitelistChannel(message.channel)) {
    if (!memberHasRoleGrantAccess(message.member, message.author.id)) {
      await message.reply('Staff and above only.').catch(() => null);
      return;
    }

    const userId = extractDiscordId(message.content);
    if (!userId) {
      const row = roleGrantPanel(message.member, message.author.id);
      if (row) {
        await message.reply({
          content: 'Use the dropdown to choose which role to give.',
          components: [row]
        }).catch(() => null);
      } else {
        await message.reply('No role grant options are configured for your rank.').catch(() => null);
      }
      return;
    }

    if (!memberHasSeniorRoleGrantAccess(message.member, message.author.id)) {
      await message.reply('Only server manager, co-owner, owner, or founder can give whitelisted. Use the dropdown for PD, UHS, or Business Owner.').catch(() => null);
      return;
    }

    try {
      const member = await grantWhitelistedRole(message.guild, userId, `Whitelisted by ${message.author.tag}`);
      await message.reply(`Whitelisted ${member.user.tag}.`).catch(() => null);
    } catch (error) {
      await message.reply(`Whitelist failed: ${error.message}`).catch(() => null);
    }
    return;
  }

  if (!message.content.startsWith('!unova')) return;

  const [, cmd, targetId, ...reasonParts] = message.content.split(' ');

  if (!isManagementMember(message.member, message.author.id)) {
    return message.reply('Management only.');
  }

  if (cmd === 'ping') {
    return message.reply('Unova Management is online.');
  }

  if (cmd === 'help' || !cmd) {
    return message.reply([
      '**Unova Management commands**',
      '`!unova ping` - test that the bot can read and reply',
      '`!unova help` - show this message',
      '`!unova kick <discord_id> <reason>` - management-only Discord kick',
      '`!unova ban <discord_id> <reason>` - add ban role and remove configured roles',
      '`/whitelist <user_id>` - give the whitelisted role',
      '`/ticket open` - open a private management ticket',
      '`/add` - add a user to a management ticket'
    ].join('\n'));
  }

  const reason = reasonParts.join(' ') || 'No reason provided';
  const member = targetId ? await message.guild.members.fetch(targetId).catch(() => null) : null;

  if (cmd === 'kick' && member) {
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return message.reply('Bot missing Kick Members.');
    }
    await member.kick(reason);
    await logToStaff([
      '**Discord Kick**',
      `Actor: <@${message.author.id}> (${message.author.id})`,
      `Target: <@${targetId}> (${targetId})`,
      `Channel: <#${message.channel.id}>`,
      `Reason: ${compactLogText(reason)}`
    ].join('\n'));
    return message.reply('Kicked from Discord. Use the FiveM UI for city sync.');
  }

  if (cmd === 'ban' && targetId) {
    if (!member) {
      return message.reply('Could not find that member in Discord.');
    }
    try {
      const result = await applyDiscordBanRole(member, reason);
      if (!result.ok) return message.reply(result.message);
    } catch (error) {
      return message.reply(`Role ban failed: ${error.message}`);
    }
    await logToStaff([
      '**Discord Role Ban**',
      `Actor: <@${message.author.id}> (${message.author.id})`,
      `Target: <@${targetId}> (${targetId})`,
      `Channel: <#${message.channel.id}>`,
      `Reason: ${compactLogText(reason)}`
    ].join('\n'));
    return message.reply('Ban role applied and configured roles removed.');
  }
});

client.on(Events.MessageDelete, async (message) => {
  if (message.partial) message = await message.fetch().catch(() => message);
  if (!message.guild || message.author?.bot) return;
  await logToStaff([
    '**Message Deleted**',
    `Author: ${message.author ? `<@${message.author.id}> (${message.author.id})` : 'unknown'}`,
    `Channel: <#${message.channel.id}>`,
    `Content: ${compactLogText(message.content)}`
  ].join('\n'));
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (oldMessage.partial) oldMessage = await oldMessage.fetch().catch(() => oldMessage);
  if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => newMessage);
  if (!newMessage.guild || newMessage.author?.bot) return;
  const before = oldMessage.content || '';
  const after = newMessage.content || '';
  if (before === after) return;
  await logToStaff([
    '**Message Edited**',
    `Author: <@${newMessage.author.id}> (${newMessage.author.id})`,
    `Channel: <#${newMessage.channel.id}>`,
    `Before: ${compactLogText(before)}`,
    `After: ${compactLogText(after)}`
  ].join('\n'));
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
  console.error(`[Unova Bot] Login failed: ${error.message}`);
  if (require.main === module) {
    process.exit(1);
  }
});
