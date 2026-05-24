require('dotenv').config();

const {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');
const axios = require('axios');

if (!process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN === 'your_bot_token') {
  console.error('Missing DISCORD_BOT_TOKEN. Add your real bot token to .env before starting Unova Management.');
  process.exit(1);
}

const guildId = process.env.DISCORD_GUILD_ID;
const founderDiscordId = process.env.FOUNDER_DISCORD_ID;
const founderRoleId = process.env.FOUNDER_ROLE_ID;
const ticketCategoryId = process.env.DISCORD_TICKET_CATEGORY_ID || process.env.TICKET_CATEGORY_ID;
const ticketCategoryName = process.env.DISCORD_TICKET_CATEGORY_NAME || process.env.TICKET_CATEGORY_NAME || 'tickets';
const configuredBotRoleId = process.env.DISCORD_BOT_ROLE_ID;
const configuredBotUserId = process.env.DISCORD_BOT_USER_ID;
const dashboardUrl = process.env.DASHBOARD_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
const whitelistedRoleId = process.env.WHITELISTED_ROLE_ID;
const botDisplayName = process.env.DISCORD_BOT_DISPLAY_NAME || 'Unova Management';
const whitelistChannelName = process.env.DISCORD_WHITELIST_CHANNEL_NAME || 'whitelist-management';
let whitelistChannelId = process.env.DISCORD_WHITELIST_CHANNEL_ID;
const hasFounderDiscordId = founderDiscordId && founderDiscordId !== 'your_discord_user_id';
const onlineFiveMDiscordIds = new Set();
const vcDmCooldowns = new Map();

if (!guildId || guildId === 'your_discord_server_id') {
  console.warn('DISCORD_GUILD_ID is not configured. Slash commands will not be registered.');
}

if (!hasFounderDiscordId && !founderRoleId && !process.env.MANAGEMENT_ROLE_IDS && !process.env.ADMIN_UI_ROLE_IDS) {
  console.warn('FOUNDER_DISCORD_ID, FOUNDER_ROLE_ID, MANAGEMENT_ROLE_IDS, or ADMIN_UI_ROLE_IDS is required for management commands.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const ticketAllow = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks
];

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

function managementRoleIds(guild) {
  return cleanIdList(
    founderRoleId,
    process.env.MANAGEMENT_ROLE_IDS,
    process.env.ADMIN_UI_ROLE_IDS,
    roleIdsByName(guild, process.env.MANAGEMENT_ROLE_NAMES, process.env.ADMIN_UI_ROLE_NAMES).join(',')
  );
}

function ticketAccessRoleIds(guild) {
  return cleanIdList(
    founderRoleId,
    process.env.MANAGEMENT_ROLE_IDS,
    process.env.ADMIN_UI_ROLE_IDS,
    process.env.TICKET_ACCESS_ROLE_IDS,
    roleIdsByName(
      guild,
      process.env.MANAGEMENT_ROLE_NAMES,
      process.env.ADMIN_UI_ROLE_NAMES,
      process.env.TICKET_ACCESS_ROLE_NAMES
    ).join(',')
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
  if (hasFounderDiscordId && userId === founderDiscordId) return true;
  return memberHasAnyRole(member, managementRoleIds(member?.guild));
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

function makeTicketName(label, userId) {
  const suffix = userId ? userId.slice(-6) : Date.now().toString().slice(-6);
  return `management-${label}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
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

  if (cleanId(founderDiscordId)) {
    overwrites.push({ id: founderDiscordId, allow: ticketAllow });
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
  return Boolean(channel && channel.topic && channel.topic.includes('unova-founder-ticket'));
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

async function createFounderTicket(guild, options) {
  const targetUser = options.targetUser || null;
  const reason = options.reason || 'No reason provided';
  const label = options.label || 'ticket';
  const extraUserIds = targetUser ? [targetUser.id] : [];
  const channelOptions = {
    name: makeTicketName(label, targetUser && targetUser.id),
    type: ChannelType.GuildText,
    topic: `unova-founder-ticket | source=${options.source || 'discord'} | target=${targetUser ? targetUser.id : 'none'}`,
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
  const managementLine = cleanId(founderRoleId) ? `Management role: <@&${founderRoleId}>` : `Management: <@${founderDiscordId}>`;

  await channel.send([
    '**Management ticket opened**',
    managementLine,
    targetLine,
    `Reason: ${reason}`,
    '',
    'Use `/add` in this channel to add another Discord user.'
  ].join('\n'));

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
      .setDescription('Give the whitelisted role to a Discord user ID.')
      .addStringOption((option) =>
        option.setName('user_id').setDescription('Discord user ID or mention.').setRequired(true)
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
  const channelId = cleanId(process.env.DISCORD_LOG_CHANNEL_ID);
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel) channel.send(message).catch(() => {});
}

function extractDiscordId(value) {
  return cleanId(String(value || '').match(/\d{15,25}/)?.[0]);
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

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!newState.channelId || oldState.channelId === newState.channelId) return;
  if (!cleanId(whitelistedRoleId)) return;

  const member = newState.member;
  if (!member || member.user.bot) return;
  if (!memberHasRole(member, whitelistedRoleId)) return;
  if (!onlineFiveMDiscordIds.has(member.id)) return;

  await newState.disconnect('Whitelisted player is in FiveM city and cannot use Discord VC.').catch(() => null);
  await dmMetagamingWarning(member);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!isManagementMember(interaction.member, interaction.user.id)) {
    return interaction.reply({ content: 'Management only.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'ticket') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'open') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Management ticket';
      const channel = await createFounderTicket(interaction.guild, {
        targetUser: user,
        reason,
        label: 'ticket',
        source: 'slash-command'
      });
      return interaction.editReply(`Ticket opened: ${channel}`);
    }

    if (subcommand === 'close') {
      if (!isTicketChannel(interaction.channel)) {
        return interaction.reply({ content: 'Use this inside a management ticket channel.', flags: MessageFlags.Ephemeral });
      }

      await interaction.reply({ content: 'Closing this management ticket.', flags: MessageFlags.Ephemeral });
      await interaction.channel.delete('Management ticket closed.');
      return;
    }
  }

  if (interaction.commandName === 'whitelist') {
    const userId = extractDiscordId(interaction.options.getString('user_id', true));
    if (!userId) {
      return interaction.reply({ content: 'Send a valid Discord user ID or mention.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const member = await grantWhitelistedRole(interaction.guild, userId, `Whitelisted by ${interaction.user.tag}`);
      return interaction.editReply(`Whitelisted ${member.user.tag}.`);
    } catch (error) {
      return interaction.editReply(`Whitelist failed: ${error.message}`);
    }
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

  if (isWhitelistChannel(message.channel)) {
    if (!isManagementMember(message.member, message.author.id)) {
      await message.reply('Management only.').catch(() => null);
      return;
    }

    const userId = extractDiscordId(message.content);
    if (!userId) {
      await message.reply('Send a Discord user ID or mention to give the whitelisted role.').catch(() => null);
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

  if (!isManagementMember(message.member, message.author.id)) {
    return message.reply('Management only.');
  }

  const reason = reasonParts.join(' ') || 'No reason provided';
  const member = targetId ? await message.guild.members.fetch(targetId).catch(() => null) : null;

  if (cmd === 'kick' && member) {
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return message.reply('Bot missing Kick Members.');
    }
    await member.kick(reason);
    await logToStaff(`Discord kick: <@${targetId}> | ${reason}`);
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
    await logToStaff(`Discord role ban: <@${targetId}> | ${reason}`);
    return message.reply('Ban role applied and configured roles removed.');
  }
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
  console.error(`[Unova Bot] Login failed: ${error.message}`);
  if (require.main === module) {
    process.exit(1);
  }
});
