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
  console.error('Missing DISCORD_BOT_TOKEN. Add your real bot token to .env before starting FounderBot.');
  process.exit(1);
}

const guildId = process.env.DISCORD_GUILD_ID;
const founderDiscordId = process.env.FOUNDER_DISCORD_ID;
const founderRoleId = process.env.FOUNDER_ROLE_ID;
const ticketCategoryId = process.env.DISCORD_TICKET_CATEGORY_ID || process.env.TICKET_CATEGORY_ID;
const configuredBotRoleId = process.env.DISCORD_BOT_ROLE_ID;
const configuredBotUserId = process.env.DISCORD_BOT_USER_ID;
const dashboardUrl = process.env.DASHBOARD_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
const whitelistedRoleId = process.env.WHITELISTED_ROLE_ID;
const hasFounderDiscordId = founderDiscordId && founderDiscordId !== 'your_discord_user_id';
const onlineFiveMDiscordIds = new Set();
const vcDmCooldowns = new Map();

if (!guildId || guildId === 'your_discord_server_id') {
  console.warn('DISCORD_GUILD_ID is not configured. Slash commands will not be registered.');
}

if (!hasFounderDiscordId && !founderRoleId) {
  console.warn('FOUNDER_DISCORD_ID or FOUNDER_ROLE_ID is required for founder-only commands.');
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

function isFounderMember(member, userId) {
  if (hasFounderDiscordId && userId === founderDiscordId) return true;
  if (!founderRoleId || !member) return false;

  if (member.roles && member.roles.cache) {
    return member.roles.cache.has(founderRoleId);
  }

  if (Array.isArray(member.roles)) {
    return member.roles.includes(founderRoleId);
  }

  return false;
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
  return `founder-${label}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
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

  if (cleanId(founderRoleId)) {
    overwrites.push({ id: founderRoleId, allow: ticketAllow });
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

  if (cleanId(ticketCategoryId)) {
    channelOptions.parent = ticketCategoryId;
  }

  const channel = await guild.channels.create(channelOptions);
  const targetLine = targetUser ? `Target: <@${targetUser.id}> (${targetUser.id})` : 'Target: not added yet';
  const founderLine = cleanId(founderRoleId) ? `Founder role: <@&${founderRoleId}>` : `Founder: <@${founderDiscordId}>`;

  await channel.send([
    '**Founder ticket opened**',
    founderLine,
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
      .setDescription('Add a Discord user to the current founder ticket.')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to add to this ticket.').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a Discord user from the current founder ticket.')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to remove from this ticket.').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Manage founder-only tickets.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('open')
          .setDescription('Open a private founder ticket for a user.')
          .addUserOption((option) =>
            option.setName('user').setDescription('User to add to the ticket.').setRequired(true)
          )
          .addStringOption((option) =>
            option.setName('reason').setDescription('Ticket reason.').setRequired(false)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('close').setDescription('Close the current founder ticket.')
      )
  ].map((command) => command.toJSON());

  await guild.commands.set(commands);
  console.log(`[Unova Bot] Registered founder ticket slash commands in ${guild.name}.`);
}

async function logToStaff(message) {
  const channelId = cleanId(process.env.DISCORD_LOG_CHANNEL_ID);
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel) channel.send(message).catch(() => {});
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[Unova Bot] Logged in as ${readyClient.user.tag}`);
  readyClient.user.setActivity('Managing Unova');
  await refreshOnlineFiveMDiscordIds();
  setInterval(refreshOnlineFiveMDiscordIds, 10000);
  await registerSlashCommands(readyClient).catch((error) => {
    console.error(`[Unova Bot] Slash command registration failed: ${error.message}`);
  });
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

  if (!isFounderMember(interaction.member, interaction.user.id)) {
    return interaction.reply({ content: 'Founder only.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'ticket') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'open') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Founder ticket';
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
        return interaction.reply({ content: 'Use this inside a founder ticket channel.', flags: MessageFlags.Ephemeral });
      }

      await interaction.reply({ content: 'Closing this founder ticket.', flags: MessageFlags.Ephemeral });
      await interaction.channel.delete('Founder ticket closed by founder.');
      return;
    }
  }

  if (interaction.commandName === 'add') {
    if (!isTicketChannel(interaction.channel)) {
      return interaction.reply({ content: 'Use `/add` inside a founder ticket channel.', flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user', true);
    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });
    await interaction.reply({ content: `Added ${user} to this founder ticket.` });
    return;
  }

  if (interaction.commandName === 'remove') {
    if (!isTicketChannel(interaction.channel)) {
      return interaction.reply({ content: 'Use `/remove` inside a founder ticket channel.', flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user', true);
    await interaction.channel.permissionOverwrites.delete(user.id).catch(() => null);
    await interaction.reply({ content: `Removed ${user} from this founder ticket.` });
  }
});

// Lightweight text-command fallback. Main moderation should come from the FiveM UI/API.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith('!unova')) return;

  const [, cmd, targetId, ...reasonParts] = message.content.split(' ');

  if (cmd === 'ping') {
    return message.reply('FounderBot is online.');
  }

  if (cmd === 'help' || !cmd) {
    return message.reply([
      '**FounderBot commands**',
      '`!unova ping` - test that the bot can read and reply',
      '`!unova help` - show this message',
      '`!unova kick <discord_id> <reason>` - founder-only Discord kick',
      '`!unova ban <discord_id> <reason>` - founder-only Discord ban',
      '`/ticket open` - open a private founder ticket',
      '`/add` - add a user to a founder ticket'
    ].join('\n'));
  }

  if (!isFounderMember(message.member, message.author.id)) {
    return message.reply('Founder only.');
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
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply('Bot missing Ban Members.');
    }
    await message.guild.members.ban(targetId, { reason });
    await logToStaff(`Discord ban: <@${targetId}> | ${reason}`);
    return message.reply('Banned from Discord. Use the FiveM UI for city sync.');
  }
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((error) => {
  console.error(`[Unova Bot] Login failed: ${error.message}`);
  if (require.main === module) {
    process.exit(1);
  }
});
