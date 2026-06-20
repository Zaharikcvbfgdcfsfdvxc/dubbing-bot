const fs = require('fs');
const path = require('path');
const { parseReplicaTranscript } = require('../utils/transcriptParser');
const db = require('../db/index');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Verify that a WAV file has a valid RIFF/WAVE header.
 */
function verifyWavHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(12);
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    return riff === 'RIFF' && wave === 'WAVE';
  } catch {
    return false;
  }
}

/**
 * Scan the data/ directory and populate the database.
 *
 * Structure:
 *   data/
 *     {project_name}/
 *       {media_id}/
 *         original.wav      ← audio file
 *         transcript.txt    ← Оригинал: / Перевод:
 *         info.json         ← { media_id, character, duration }
 */
function scanDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('[scanner] Data directory not found, creating:', DATA_DIR);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return { projects: 0, characters: 0, replicas: 0 };
  }

  // Clear existing data for a fresh scan
  db.clearProjectData();

  const projectFolders = fs.readdirSync(DATA_DIR).filter(name => {
    const fullPath = path.join(DATA_DIR, name);
    return fs.statSync(fullPath).isDirectory();
  });

  let projectCount = 0;
  let characterCount = 0;
  let replicaCount = 0;

  // Track characters per project for uniqueness
  const charCache = new Map(); // key: "projectId:charName" → character id

  for (const projectName of projectFolders) {
    const projectPath = path.join(DATA_DIR, projectName);

    // Upsert project
    db.upsertProject(projectName, projectPath);
    const project = db.getDb().prepare('SELECT id FROM projects WHERE name = ?').get(projectName);
    if (!project) continue;
    projectCount++;

    // Scan media_id subfolders
    const entries = fs.readdirSync(projectPath).filter(name => {
      const fullPath = path.join(projectPath, name);
      return fs.statSync(fullPath).isDirectory();
    });

    // Group replicas by character (from info.json)
    let replicaIndex = 0;

    for (const mediaId of entries) {
      const replicaPath = path.join(projectPath, mediaId);
      const audioFile = path.join(replicaPath, 'original.wav');
      const transcriptFile = path.join(replicaPath, 'transcript.txt');
      const infoFile = path.join(replicaPath, 'info.json');

      // Skip if no audio file
      if (!fs.existsSync(audioFile)) {
        console.log(`[scanner] Skipping ${projectName}/${mediaId}: no original.wav`);
        continue;
      }

      // Read info.json
      let info = { media_id: mediaId, character: 'Unknown', duration: 0 };
      if (fs.existsSync(infoFile)) {
        try {
          info = JSON.parse(fs.readFileSync(infoFile, 'utf-8'));
        } catch (err) {
          console.log(`[scanner] WARNING: invalid info.json in ${projectName}/${mediaId}`);
        }
      }

      const characterName = info.character || 'Unknown';
      const duration = info.duration || 0;

      // Read transcript
      let transcript = '';
      let translation = '';
      if (fs.existsSync(transcriptFile)) {
        const text = fs.readFileSync(transcriptFile, 'utf-8');
        const parsed = parseReplicaTranscript(text);
        transcript = parsed.transcript;
        translation = parsed.translation;
      }

      // Validate WAV
      if (!verifyWavHeader(audioFile)) {
        console.log(`[scanner] WARNING: ${projectName}/${mediaId}/original.wav has invalid header`);
      }

      // Upsert character (get or create)
      const cacheKey = `${project.id}:${characterName}`;
      let characterId = charCache.get(cacheKey);
      if (!characterId) {
        db.upsertCharacter(project.id, characterName, replicaPath);
        const character = db.getDb().prepare(
          'SELECT id FROM characters WHERE project_id = ? AND name = ?'
        ).get(project.id, characterName);
        if (character) {
          characterId = character.id;
          charCache.set(cacheKey, characterId);
          characterCount++;
        }
      }

      if (!characterId) continue;

      // Upsert replica
      db.upsertReplica(
        characterId,
        String(mediaId),
        'original.wav',
        transcript,
        translation,
        audioFile,
        replicaIndex,
        duration
      );
      replicaIndex++;
      replicaCount++;
    }

    console.log(`[scanner] ${projectName}: ${entries.length} media folders, ${replicaCount} replicas total`);
  }

  console.log(`[scanner] Done: ${projectCount} projects, ${characterCount} characters, ${replicaCount} replicas`);
  return { projects: projectCount, characters: characterCount, replicas: replicaCount };
}

module.exports = { scanDataDir, DATA_DIR };
