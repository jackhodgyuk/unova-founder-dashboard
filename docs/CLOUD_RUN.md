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
unova-founder-dashboard
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

## Environment Variables

Add these in Cloud Run under **Variables and secrets**:

```env
DASHBOARD_URL=https://YOUR-CLOUD-RUN-URL
DASHBOARD_JWT_SECRET=your_founder_key
FIVEM_API_KEY=your_fivem_api_key
FOUNDER_DISCORD_ID=681156025365299220
FOUNDER_ROLE_ID=
MANAGEMENT_ROLE_IDS=
ADMIN_UI_ROLE_IDS=
WHITELISTED_ROLE_ID=
DISCORD_GUILD_ID=1450604375771713649
DISCORD_TICKET_CATEGORY_ID=
DISCORD_TICKET_CATEGORY_NAME=tickets
TICKET_ACCESS_ROLE_IDS=
DISCORD_BAN_ROLE_ID=
DISCORD_BAN_REMOVE_ROLE_IDS=
DISCORD_WHITELIST_CHANNEL_ID=
DISCORD_WHITELIST_CHANNEL_NAME=whitelist-management
DISCORD_BOT_USER_ID=1507920493335023646
DISCORD_BOT_ROLE_ID=
DISCORD_BOT_DISPLAY_NAME=Unova Management
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_LOG_CHANNEL_ID=1451550213595467889
MYSQL_HOST=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=
```

The MySQL values can stay blank while testing. The API keeps running and skips database writes if MySQL is unavailable.

## XRealm Server Config

After Cloud Run deploys, update XRealm:

```cfg
set unova_dashboard_url "https://YOUR-CLOUD-RUN-URL"
set unova_dashboard_key "same value as FIVEM_API_KEY"
set unova_founder_discord_id "681156025365299220"

add_ace identifier.discord:681156025365299220 unova.admin allow

ensure unova_dashboard_bridge
```

## Test URLs

```txt
https://YOUR-CLOUD-RUN-URL/healthz
https://YOUR-CLOUD-RUN-URL/dashboard/
```
