const { initDb } = require('./db/index');

async function main() {
  // Init database first (sql.js is async)
  await initDb();

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
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
