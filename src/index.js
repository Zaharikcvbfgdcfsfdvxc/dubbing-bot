const { createBot } = require('./bot/index');
const { startWeb } = require('./web/index');

const { bot, startBot } = createBot();

// Start web interface (with bot instance for notifications)
startWeb(bot);

// Start Telegram bot
if (startBot) {
  startBot();
} else {
  console.error('Bot token not configured. Set BOT_TOKEN environment variable.');
  process.exit(1);
}
