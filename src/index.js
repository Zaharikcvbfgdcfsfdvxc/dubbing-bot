const { createBot } = require('./bot/index');
const { startWeb } = require('./web/index');

const { bot, startBot } = createBot();

startWeb(bot);

if (startBot) {
  startBot();
} else {
  console.error('Bot token not configured. Set BOT_TOKEN environment variable.');
  process.exit(1);
}
