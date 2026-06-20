const { createBot } = require('./bot/index');
const { startWeb } = require('./web/index');

// Start web interface
startWeb();

// Start Telegram bot
const { startBot } = createBot();

if (startBot) {
  startBot();
} else {
  console.error('Bot token not configured. Set BOT_TOKEN environment variable.');
  process.exit(1);
}
