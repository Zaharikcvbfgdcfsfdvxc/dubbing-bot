const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/index');

const app = express();
const PORT = process.env.WEB_PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let botInstance = null;

app.get('/api/dubs', async (req, res) => {
  const rows = await db.getAllDubsReport();
  const projects = {};
  for (const r of rows) {
    if (!projects[r.project]) projects[r.project] = {};
    if (!projects[r.project][r.character]) projects[r.project][r.character] = [];
    projects[r.project][r.character].push({
      dub_id: r.dub_id, media_id: r.media_id,
      user: r.username ? `@${r.username}` : (r.first_name || String(r.telegram_id)),
      telegram_id: r.telegram_id, status: r.status,
      audio_path: r.audio_path, created_at: r.created_at,
    });
  }
  res.json(projects);
});

app.post('/api/reject', async (req, res) => {
  try {
    const { dubId } = req.body;
    if (!dubId) return res.status(400).json({ error: 'dubId required' });

    console.log(`[web] Reject request for dubId=${dubId}`);

    await db.rejectDub(dubId);
    console.log(`[web] dubId=${dubId} status set to rejected`);

    const info = await db.getDubById(dubId);
    console.log(`[web] getDubById(${dubId}):`, info ? `found, telegram_id=${info.telegram_id}` : 'NULL');

    if (!info) {
      console.error(`[web] dubId=${dubId} not found after reject!`);
      return res.status(404).json({ error: 'Dub not found' });
    }

    if (!botInstance) {
      console.error('[web] botInstance is null — notification skipped');
      return res.json({ ok: true, dub: info, notified: false, reason: 'botInstance is null' });
    }

    if (!info.telegram_id) {
      console.error(`[web] info.telegram_id is empty for dubId=${dubId}`);
      return res.json({ ok: true, dub: info, notified: false, reason: 'telegram_id missing' });
    }

    const msg = `❌ <b>Отбраковка</b>\n\n` +
      `Твоя запись реплики <b>#${info.media_id}</b> ` +
      `(${info.project_name} / ${info.character_name}) была отбракована.\n\n` +
      `Отправь /start → выбери персонажа → перезапиши эту реплику.`;

    console.log(`[web] Sending reject notification to telegram_id=${info.telegram_id}`);
    try {
      await botInstance.api.sendMessage(info.telegram_id, msg, { parse_mode: 'HTML' });
      console.log(`[web] Notification sent to ${info.telegram_id}`);
      res.json({ ok: true, dub: info, notified: true });
    } catch (sendErr) {
      console.error('[web] sendMessage failed:', sendErr.message);
      if (sendErr.error) console.error('[web] Telegram API error:', JSON.stringify(sendErr.error));
      res.json({ ok: true, dub: info, notified: false, reason: sendErr.message });
    }
  } catch (err) {
    console.error('[web] /api/reject error:', err.message);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

app.get('/api/replicas', async (req, res) => {
  try {
    const rows = await db.getAllReplicasReport();
    const projects = {};
    for (const r of rows) {
      if (!projects[r.project]) projects[r.project] = {};
      if (!projects[r.project][r.character]) projects[r.project][r.character] = [];
      projects[r.project][r.character].push({ media_id: r.media_id, transcript: r.transcript, translation: r.translation, duration: r.duration });
    }
    res.json(projects);
  } catch (err) {
    console.error('[web] /api/replicas error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/audio', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'audio/ogg');
  fs.createReadStream(filePath).pipe(res);
});

app.get('/api/original', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'audio/wav');
  fs.createReadStream(filePath).pipe(res);
});

function startWeb(bot) {
  botInstance = bot;
  app.listen(PORT, () => { console.log(`[web] Interface on http://localhost:${PORT}`); });
}

module.exports = { startWeb };
