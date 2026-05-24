const { startServer } = require('./api/server');

startServer(() => {
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN !== 'your_bot_token') {
    require('./bot/index');
  } else {
    console.warn('[Unova Bot] Skipping Discord bot startup: DISCORD_BOT_TOKEN is not configured.');
  }
});
