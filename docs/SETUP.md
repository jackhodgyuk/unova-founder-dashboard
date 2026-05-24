# Unova Management Dashboard Setup

## 1. Access Model

Dashboard access is Firebase-only.

Give each Firebase user one of these custom claims:

```json
{ "unovaRole": "founder" }
{ "unovaRole": "owner" }
{ "unovaRole": "co_owner" }
{ "unovaRole": "admin" }
```

Optional but recommended for clean Discord mentions in tickets and dashboard action history:

```json
{ "discordId": "681156025365299220" }
```

Discord bot commands and FiveM `/adminui` use one Discord role:

```env
MANAGEMENT_ROLE_ID=your_management_role_id
```

Anyone with that Discord role can:

```txt
Use management bot commands
Use /whitelist
Use the whitelist-management channel
Open /adminui in city
See private management tickets
```

The ticket ladder uses these Discord role IDs:

```env
STAFF_ROLE_ID=
SENIOR_STAFF_ROLE_ID=
STAFF_MANAGER_ROLE_ID=
SERVER_MANAGER_ROLE_ID=
CO_OWNER_ROLE_ID=
OWNER_ROLE_ID=
FOUNDER_ROLE_ID=
DEVELOPER_ROLE_ID=
HEAD_DEVELOPER_ROLE_ID=
```

## 2. Configure Env

Copy:

```txt
.env.example
```

to:

```txt
.env
```

Fill in:

```env
DASHBOARD_URL=
FIVEM_API_KEY=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_BOT_USER_ID=
DISCORD_BOT_ROLE_ID=
DISCORD_LOG_CHANNEL_ID=
MANAGEMENT_ROLE_ID=
FOUNDER_DISCORD_ID=
FOUNDER_ROLE_ID=
OWNER_ROLE_ID=
CO_OWNER_ROLE_ID=
SERVER_MANAGER_ROLE_ID=
STAFF_MANAGER_ROLE_ID=
SENIOR_STAFF_ROLE_ID=
STAFF_ROLE_ID=
DEVELOPER_ROLE_ID=
HEAD_DEVELOPER_ROLE_ID=
WHITELISTED_ROLE_ID=
DISCORD_TICKET_CATEGORY_ID=
DISCORD_TICKET_CATEGORY_NAME=tickets
DISCORD_BAN_ROLE_ID=
DISCORD_BAN_REMOVE_ROLE_IDS=
PRIORITY_ROLE_RULES=
DISCORD_WHITELIST_CHANNEL_ID=
DISCORD_WHITELIST_CHANNEL_NAME=whitelist-management
MYSQL_HOST=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=unova_dashboard
```

## 3. Firebase Dashboard Login

Enable Email/Password sign-in in Firebase Authentication.

Add the Cloud Run domain to Firebase Authentication authorized domains:

```txt
unova-founder-dashboard-git-597032418775.europe-west1.run.app
```

Create users in Firebase Authentication. The dashboard does not create users.

Give dashboard access by adding their email to the right Cloud Run variable:

```env
DASHBOARD_FOUNDER_EMAILS=founder@example.com
DASHBOARD_OWNER_EMAILS=
DASHBOARD_CO_OWNER_EMAILS=
DASHBOARD_ADMIN_EMAILS=
```

Comma-separate multiple emails. You can also set Firebase custom claims, for example:

```json
{
  "unovaRole": "founder",
  "discordId": "681156025365299220"
}
```

The dashboard rejects signed-in users with no dashboard role from either email lists or custom claims.

## 4. Install Packages

Run inside the main folder:

```bash
npm install
```

## 5. Start API And Bot

For testing:

```bash
npm run api
npm run bot
```

Or both together:

```bash
npm run dev
```

## 6. Discord Bot Permissions

Invite the bot with these permissions:

```txt
View Channels
Send Messages
Read Message History
Embed Links
Use Application Commands
Manage Messages
Kick Members
Manage Roles
Manage Channels
```

The bot role must be above the roles it needs to add/remove, especially:

```txt
WHITELISTED_ROLE_ID
DISCORD_BAN_ROLE_ID
DISCORD_BAN_REMOVE_ROLE_IDS
```

## 7. FiveM Resource

Put `unova_dashboard_bridge` into your XRealm resources and add:

```cfg
set unova_dashboard_url "https://YOUR-CLOUD-RUN-URL"
set unova_dashboard_key "SAME_AS_FIVEM_API_KEY"

ensure unova_dashboard_bridge
```

In-game, management can run:

```txt
/adminui
```

The resource sends the player's Discord ID to Cloud Run. Cloud Run checks whether that Discord member has `MANAGEMENT_ROLE_ID`.

## 8. Management Tickets

The bot registers:

```txt
/panel tickets
/panel settings
/ticket open
/ticket close
/add
/remove
/whitelist
```

`/panel settings` is founder-only. `/panel tickets` posts a public Discord panel with:

```txt
Open Support Ticket
Bug Report
```

Support tickets start with staff. Bug reports start with developer/head developer.

Escalation flow:

```txt
Staff -> Senior Staff -> Staff Manager -> Server Manager -> Co-Owners/Owners -> Founder
Developer/Head Developer -> Co-Owners/Owners -> Founder
Developer/Head Developer -> Staff, if it should go back to support
```

Co-owners, owners, and founders can override normal player tickets. Only the founder can override locked tickets created by the founder or by FiveM moderation actions.

Management tickets are private. By default, only these can see them:

```txt
MANAGEMENT_ROLE_ID
TICKET_ACCESS_ROLE_IDS, if configured
DISCORD_BOT_ROLE_ID, if configured
DISCORD_BOT_USER_ID
Any user added with /add
Any target Discord user automatically added by the FiveM moderation UI
```

Set `DISCORD_TICKET_CATEGORY_ID` if you want all tickets in a specific Discord category. If no ID is set, the bot and API will use or create the category named by `DISCORD_TICKET_CATEGORY_NAME`.

## 9. Ban Role Flow

When management bans from the dashboard or in-city UI:

```txt
The player is banned/kicked in FiveM
A private Discord ticket is opened
DISCORD_BAN_ROLE_ID is added to the Discord member
DISCORD_BAN_REMOVE_ROLE_IDS are removed from the Discord member
The member is not Discord-banned
```

Role updates require the target player to have their Discord linked in FiveM.

## 10. Priority Queue

Priority is linked to Discord role IDs and can be managed from the dashboard Priority tab.

Manual Cloud Run seed format:

```env
PRIORITY_ROLE_RULES=ROLE_ID:Owner Priority:1000,ROLE_ID:Staff Priority:500
```

The FiveM bridge calls Cloud Run while players connect:

```txt
/fivem/priority/check?discordId=...
```

Players see a Unova priority queue message during the Cfx deferral stage. The resource also includes a branded loadscreen.

## 11. Whitelist Management

Set:

```env
WHITELISTED_ROLE_ID=
DISCORD_WHITELIST_CHANNEL_ID=
```

If no channel ID is set, the bot finds or creates `whitelist-management`.

Management can either use:

```txt
/whitelist user_id:123456789012345678
```

or paste a Discord ID/mention in the whitelist channel.

## 12. Anti-Metagaming VC Rule

If a member has `WHITELISTED_ROLE_ID` and their Discord ID is online i