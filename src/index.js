const { createBot } = require('./bot/index');

const { startBot } = createBot();

if (startBot) {
  startBot();
} else {
  console.error('Bot token not configured. Set BOT_TOKEN environment variable.');
  process.exit(1);
}
