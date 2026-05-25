# Cloud Run Deployment

## Console Choices

Use these on the Cloud Run create-service page:

```txt
Continuously deploy from a repository
Cloud Build
Allow public access
```

Recommended service name:

```txt
unova-founder-dashboard-git
```

Recommended region:

```txt
europe-west1
```

## Container Settings

Set:

```txt
Container port: 8080
Minimum instances: 1
Maximum instances: 1
CPU allocation: Always allocated / instance-based billing
```

Cloud Run provides `$PORT`; the app reads it automatically.

## Required Environment Variables

Keep these in Cloud Run under **Variables and secrets**:

```env
DASHBOARD_URL=https://YOUR-CLOUD-RUN-URL
FIVEM_API_KEY=your_fivem_api_key
DISCORD_GUILD_ID=1450604375771713649
DISCORD_BOT_USER_ID=1507920493335023646
DISCORD_BOT_ROLE_ID=
DISCORD_BOT_DISPLAY_NAME=Unova Management
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_LOG_CHANNEL_ID=1451550213595467889
MANAGEMENT_ROLE_ID=your_one_management_role_id
MANAGEMENT_ROLE_NAME=
FOUNDER_DISCORD_ID=681156025365299220
FOUNDER_ROLE_ID=
OWNER_ROLE_ID=
CO_OWNER_ROLE_ID=
SERVER_MANAGER_ROLE_ID=
STAFF_MANAGER_ROLE_ID=
SENIOR_STAFF_ROLE_ID=
STAFF_ROLE_ID=
DEVELOPER_ROLE_ID=
HEAD_DEVELOPER_ROLE_ID=
WHITELISTED_ROLE_ID=your_whitelisted_role_id
DISCORD_TICKET_CATEGORY_ID=
DISCORD_TICKET_CATEGORY_NAME=tickets
TICKET_ACCESS_ROLE_IDS=
DISCORD_BAN_ROLE_ID=your_banned_role_id
DISCORD_BAN_REMOVE_ROLE_IDS=roles_to_remove_when_banned
PRIORITY_ROLE_RULES=
DISCORD_WHITELIST_CHANNEL_ID=
DISCORD_WHITELIST_CHANNEL_NAME=whitelist-management
MYSQL_HOST=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=
```

The MySQL values can stay blank while testing. The API keeps running and skips database writes if MySQL is unavailable.

## Firebase Email/Password Login

In Firebase Console, enable:

```txt
Authentication -> Sign-in method -> Email/Password
```

Create users in:

```txt
Authentication -> Users -> Add user
```

The dashboard does not create Firebase users. It signs them in with Firebase email/password and lets the signed-in user change their own dashboard name and password.

The founder can assign dashboard roles in Settings after their own Firebase user has the founder custom claim.

`jackhodgyuk@gmail.com` is locked as the founder account by default. Override only if ownership changes:

```env
LOCKED_FOUNDER_EMAIL=jackhodgyuk@gmail.com
```

## Optional Firebase Variables

The app already includes the Firebase web config for the FounderBot project. Add these only if you recreate the Firebase web app or want the config managed from Cloud Run:

```env
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MEASUREMENT_ID=
```

Dashboard access can also be granted by Firebase custom claims:

```json
{ "unovaRole": "founder" }
{ "unovaRole": "owner" }
{ "unovaRole": "co_owner" }
{ "unovaRole": "server_manager" }
{ "unovaRole": "staff_manager" }
{ "unovaRole": "senior_staff" }
{ "unovaRole": "staff" }
```

If you want dashboard moderation tickets to show the moderator as a Discord mention, also set this custom claim on that Firebase user:

```json
{ "discordId": "681156025365299220" }
```

## Variables To Remove

Remove these old variables after this deployment is live:

```env
DASHBOARD_JWT_SECRET
ADMIN_UI_ROLE_IDS
FOUNDER_FIREBASE_UID
MANAGEMENT_ROLE_IDS
ADMIN_UI_ROLE_NAMES
MANAGEMENT_ROLE_NAMES
DASHBOARD_FOUNDER_EMAILS
DASHBOARD_OWNER_EMAILS
DASHBOARD_CO_OWNER_EMAILS
DASHBOARD_ADMIN_EMAILS
```

Keep `MANAGEMENT_ROLE_ID`; that is now the one Discord role that controls Discord bot permissions and in-city `/adminui` permissions.

Keep `FOUNDER_DISCORD_ID` and `FOUNDER_ROLE_ID` if you want founder-only Discord settings and locked-ticket override protection. They do not control dashboard login anymore; Firebase custom claims do that.

## XRealm Server Config

After Cloud Run deploys, update XRealm:

```cfg
set unova_dashboard_url "https://YOUR-CLOUD-RUN-URL"
set unova_dashboard_key "same value as FIVEM_API_KEY"

ensure unova_dashboard_bridge
```

You do not need `set unova_founder_discord_id` anymore. The city asks Cloud Run whether the player's Discord ID has `MANAGEMENT_ROLE_ID`.

## Test URLs

```txt
https://YOUR-CLOUD-RUN-URL/healthz
https://YOUR-CLOUD-RUN-URL/dashboard/
```
