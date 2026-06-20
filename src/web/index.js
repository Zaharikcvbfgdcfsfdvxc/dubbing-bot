const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/index');

const app = express();
const PORT = process.env.WEB_PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let botInstance = null;

// API: all dubs grouped by project/character/replica
app.get('/api/dubs', (req, res) => {
  const rows = db.getAllDubsReport();
  const projects = {};

  for (const r of rows) {
    if (!projects[r.project]) {
      projects[r.project] = {};
    }
    if (!projects[r.project][r.character]) {
      projects[r.project][r.character] = [];
    }
    const who = r.username ? `@${r.username}` : (r.first_name || String(r.telegram_id));
    projects[r.project][r.character].push({
      dub_id: r.dub_id,
      media_id: r.media_id,
      user: who,
      telegram_id: r.telegram_id,
      status: r.status,
      audio_path: r.audio_path,
      created_at: r.created_at,
    });
  }

  res.json(projects);
});

// API: reject a dub
app.post('/api/reject', (req, res) => {
  const { dubId } = req.body;
  if (!dubId) return res.status(400).json({ error: 'dubId required' });

  const dub = db.rejectDub(dubId);
  const info = db.getDubById(dubId);

  if (info && botInstance) {
    const msg = `❌ <b>Отбраковка</b>\n\n` +
      `Твоя запись реплики <b>#${info.media_id}</b> ` +
      `(${info.project_name} / ${info.character_name}) была отбракована.\n\n` +
      `Отправь /start → выбери персонажа → перезапиши эту реплику.`;

    console.log(`[web] Sending reject notification to telegram_id=${info.telegram_id}`);
    botInstance.api.sendMessage(info.telegram_id, msg, { parse_mode: 'HTML' })
      .then(() => console.log(`[web] Reject notification sent to ${info.telegram_id}`))
      .catch(err => console.error('[web] Failed to notify user:', err.message, err));
  } else {
    console.log(`[web] Cannot notify: botInstance=${!!botInstance}, info=${!!info}`);
  }

  res.json({ ok: true, dub: info });
});

// API: all replicas with transcripts
app.get('/api/replicas', (req, res) => {
  const rows = db.getDb().prepare(`
    SELECT p.name as project, c.name as character, r.media_id,
           r.transcript, r.translation, r.duration, r.sort_order
    FROM replicas r
    JOIN characters c ON r.character_id = c.id
    JOIN projects p ON c.project_id = p.id
    ORDER BY p.name, c.name, r.sort_order
  `).all();

  const projects = {};
  for (const r of rows) {
    if (!projects[r.project]) projects[r.project] = {};
    if (!projects[r.project][r.character]) projects[r.project][r.character] = [];
    projects[r.project][r.character].push({
      media_id: r.media_id,
      transcript: r.transcript,
      translation: r.translation,
      duration: r.duration,
    });
  }

  res.json(projects);
});

// Serve audio files
app.get('/api/audio', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  res.setHeader('Content-Type', 'audio/ogg');
  fs.createReadStream(filePath).pipe(res);
});

// Serve original WAV
app.get('/api/original', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  res.setHeader('Content-Type', 'audio/wav');
  fs.createReadStream(filePath).pipe(res);
});

function startWeb(bot) {
  botInstance = bot;
  app.listen(PORT, () => {
    console.log(`[web] Interface running on http://localhost:${PORT}`);
  });
}

module.exports = { startWeb };
