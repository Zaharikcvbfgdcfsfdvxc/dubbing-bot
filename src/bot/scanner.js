const fs = require('fs');
const path = require('path');
const { parseReplicaTranscript } = require('../utils/transcriptParser');
const db = require('../db/index');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function verifyWavHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(12);
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  } catch { return false; }
}

function isReplicaFolder(dirPath) {
  return fs.existsSync(path.join(dirPath, 'original.wav')) ||
         fs.existsSync(path.join(dirPath, 'info.json'));
}

function readInfoJson(replicaPath) {
  const infoFile = path.join(replicaPath, 'info.json');
  if (fs.existsSync(infoFile)) {
    try { return JSON.parse(fs.readFileSync(infoFile, 'utf-8')); } catch {}
  }
  return {};
}

async function scanDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return { projects: 0, characters: 0, replicas: 0 };
  }

  await db.clearProjectData();

  const projectFolders = fs.readdirSync(DATA_DIR).filter(name =>
    fs.statSync(path.join(DATA_DIR, name)).isDirectory()
  );

  let projectCount = 0, characterCount = 0, replicaCount = 0;

  for (const projectName of projectFolders) {
    const projectPath = path.join(DATA_DIR, projectName);
    await db.upsertProject(projectName, projectPath);

    const projects = await db.getAllProjects();
    const project = projects.find(p => p.name === projectName);
    if (!project) continue;
    projectCount++;

    const entries = fs.readdirSync(projectPath).filter(name =>
      fs.statSync(path.join(projectPath, name)).isDirectory()
    );

    let characters = [];
    for (const entry of entries) {
      const entryPath = path.join(projectPath, entry);
      const subEntries = fs.readdirSync(entryPath).filter(n =>
        fs.statSync(path.join(entryPath, n)).isDirectory()
      );

      if (subEntries.length > 0 && subEntries.some(n => isReplicaFolder(path.join(entryPath, n)))) {
        characters.push({ name: entry, path: entryPath, replicaFolders: subEntries });
      } else if (isReplicaFolder(entryPath)) {
        characters.push({ name: '_flat_', path: entryPath, replicaFolders: [entry] });
      } else if (subEntries.length > 0) {
        characters.push({ name: entry, path: entryPath, replicaFolders: subEntries });
      }
    }

    let charReplicas = [];
    for (const ch of characters) {
      if (ch.name === '_flat_') {
        for (const rf of ch.replicaFolders) {
          const rfPath = path.join(ch.path, rf);
          const info = readInfoJson(rfPath);
          const charName = info.character || projectName;
          let cr = charReplicas.find(c => c.charName === charName);
          if (!cr) { cr = { charName, charPath: ch.path, replicas: [] }; charReplicas.push(cr); }
          cr.replicas.push({ mediaId: rf, path: rfPath });
        }
      } else {
        let cr = charReplicas.find(c => c.charName === ch.name);
        if (!cr) { cr = { charName: ch.name, charPath: ch.path, replicas: [] }; charReplicas.push(cr); }
        for (const rf of ch.replicaFolders) {
          cr.replicas.push({ mediaId: rf, path: path.join(ch.path, rf) });
        }
      }
    }

    for (const cr of charReplicas) {
      await db.upsertCharacter(project.id, cr.charName, cr.charPath);
      const chars = await db.getCharactersByProject(project.id);
      const charRecord = chars.find(c => c.name === cr.charName);
      if (!charRecord) continue;
      characterCount++;

      cr.replicas.sort((a, b) => a.mediaId.localeCompare(b.mediaId, 'ru', { numeric: true }));

      for (let i = 0; i < cr.replicas.length; i++) {
        const rep = cr.replicas[i];
        const audioFile = path.join(rep.path, 'original.wav');
        const transcriptFile = path.join(rep.path, 'transcript.txt');

        if (!fs.existsSync(audioFile)) continue;

        const info = readInfoJson(rep.path);
        let transcript = '', translation = '';
        if (fs.existsSync(transcriptFile)) {
          const parsed = parseReplicaTranscript(fs.readFileSync(transcriptFile, 'utf-8'));
          transcript = parsed.transcript;
          translation = parsed.translation;
        }

        if (!verifyWavHeader(audioFile)) {
          console.log(`[scanner] WARNING: ${projectName}/${cr.charName}/${rep.mediaId} invalid WAV`);
        }

        await db.upsertReplica(charRecord.id, String(rep.mediaId), 'original.wav',
          transcript, translation, audioFile, i, info.duration || 0);
        replicaCount++;
      }
    }
    console.log(`[scanner] ${projectName}: ${charReplicas.length} characters`);
  }

  console.log(`[scanner] Done: ${projectCount} projects, ${characterCount} characters, ${replicaCount} replicas`);
  return { projects: projectCount, characters: characterCount, replicas: replicaCount };
}

module.exports = { scanDataDir, DATA_DIR, isReplicaFolder };
