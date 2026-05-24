# Unova Founder Dashboard Setup

## 1. Install Node.js
Install Node.js 18+ on your VPS/panel machine.

## 2. Create database
Create a MySQL database called:

```sql
unova_dashboard
```

Then import:

```txt
sql/schema.sql
```

## 3. Configure env
Copy:

```txt
.env.example
```

to:

```txt
.env
```

Fill in:

```txt
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
FOUNDER_DISCORD_ID=
FOUNDER_ROLE_ID=
MANAGEMENT_ROLE_IDS=
ADMIN_UI_ROLE_IDS=
WHITELISTED_ROLE_ID=
DISCORD_LOG_CHANNEL_ID=
DISCORD_TICKET_CATEGORY_ID=
DISCORD_TICKET_CATEGORY_NAME=tickets
DISCORD_BAN_ROLE_ID=
DISCORD_BAN_REMOVE_ROLE_IDS=
DISCORD_WHITELIST_CHANNEL_ID=
DISCORD_WHITELIST_CHANNEL_NAME=whitelist-management
DISCORD_BOT_USER_ID=
DISCORD_BOT_ROLE_ID=
MYSQL_HOST=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=unova_dashboard
DASHBOARD_JWT_SECRET=make_this_random
FIVEM_API_KEY=make_this_random_too
```

## 4. Install packages
Run inside the main folder:

```bash
npm install
```

## 5. Start API and bot
For testing:

```bash
npm run api
npm run bot
```

Or both together:

```bash
npm run dev
```

## 6. Add Discord bot permissions
Invite the bot with these permissions:

```txt
View Channels
Send Messages
Read Message History
Embed Links
Use Application Commands
Manage Messages
Kick Members
Ban Members
Manage Roles
Manage Channels
```

The bot role must be above any role it needs to manage.

## 7. Install FiveM resource
Put this folder into your resources:

```txt
fivem-resource
```

Rename it if you want, for example:

```txt
[unc]/unova_dashboard_bridge
```

Add to `server.cfg`:

```cfg
set unova_dashboard_url "http://YOUR_API_IP:3001"
set unova_dashboard_key "SAME_AS_FIVEM_API_KEY"
ensure unova_dashboard_bridge
```

## 8. Dashboard moderation endpoint
Your future frontend buttons should call:

```txt
POST /dashboard/moderation/warn
POST /dashboard/moderation/kick
POST /dashboard/moderation/ban
```

Example body:

```json
{
  "discordId": "1234567890",
  "license": "license:abc123",
  "playerId": 1,
  "reason": "Breaking Unova rules"
}
```

## 9. Founder dev login
Temporary testing endpoint:

```txt
POST /auth/founder-dev-login
```

Body:

```json
{
  "founderKey": "same_as_DASHBOARD_JWT_SECRET"
}
```

Use the returned token as:

```txt
Authorization: Bearer TOKEN_HERE
```

## 10. Management ticket system

The bot registers these slash commands when it starts:

```txt
/ticket open
/ticket close
/add
/remove
```

Management tickets are private. By default, only these can see them:

```txt
FOUNDER_ROLE_ID, if configured
FOUNDER_DISCORD_ID
MANAGEMENT_ROLE_IDS / TICKET_ACCESS_ROLE_IDS, if configured
DISCORD_BOT_ROLE_ID, if configured
DISCORD_BOT_USER_ID
Any user added with /add
Any target Discord user automatically added by the FiveM moderation UI
```

Set `DISCORD_TICKET_CATEGORY_ID` if you want the bot to create all tickets inside a specific Discord category. If no ID is set, it will use or create a category named by `DISCORD_TICKET_CATEGORY_NAME` (`tickets` by default).

## 11. Anti-metagaming VC rule

Set:

```txt
WHITELISTED_ROLE_ID=
```

If a member has this role and their Discord ID is currently online in FiveM, the bot disconnects them from server voice channels and DMs:

```txt
You cannot metagame meaning VC and city.
This includes private VC calls.
If you are found to be metagaming, you will receive an official warning.
```

Discord bots cannot see or disconnect users from private DM calls. This system enforces the rule inside server voice channels and sends the private-call warning text.

## 12. FiveM admin UI

Add to `server.cfg`:

```cfg
set unova_dashboard_url "http://YOUR_API_IP:3001"
set unova_dashboard_key "SAME_AS_FIVEM_API_KEY"
set unova_founder_discord_id "YOUR_DISCORD_ID"
add_ace identifier.discord:YOUR_DISCORD_ID unova.admin allow
ensure unova_dashboard_bridge
```

In-game, allowed management can run:

```txt
/adminui
```

`/founderui` still works as an alias, but `/adminui` is the command to use. Access is allowed by founder Discord ID, ACE `unova.admin`, `FOUNDER_ROLE_ID`, `MANAGEMENT_ROLE_IDS`, or `ADMIN_UI_ROLE_IDS`.

The UI lets management warn, kick, or ban online players. Each action:

```txt
Creates a private Discord ticket
Logs the punishment to the API/database when available
Queues the action back to FiveM
Warns, kicks, or bans the player in city
For ban actions, applies DISCORD_BAN_ROLE_ID and removes DISCORD_BAN_REMOVE_ROLE_IDS in Discord
```

## 13. Whitelist role channel

Set `WHITELISTED_ROLE_ID`. The bot will use `DISCORD_WHITELIST_CHANNEL_ID` if set, otherwise it finds or creates `DISCORD_WHITELIST_CHANNEL_NAME`.

Management can paste a Discord user ID in that channel or use:

```txt
/whitelist user_id:123456789012345678
```

## 14. Production changes you should add later
- Replace founder dev login with Discord OAuth2.
- Add a proper React/Next.js dashboard frontend.
- Add staff roles/permissions.
- Add unban flow.
- Add punishment appeal tracking.
- Add better player identifier linking.
- Put the API behind HTTPS.
