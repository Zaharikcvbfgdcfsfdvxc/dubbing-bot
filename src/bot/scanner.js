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
  } catch {
    return false;
  }
}

/**
 * Check if a directory is a media_id folder (contains original.wav or info.json).
 */
function isReplicaFolder(dirPath) {
  return fs.existsSync(path.join(dirPath, 'original.wav')) ||
         fs.existsSync(path.join(dirPath, 'info.json'));
}

/**
 * Scan the data/ directory.
 *
 * Structure (3 levels):
 *   data/
 *     {project}/              ← project folder
 *       {character}/          ← character folder
 *         {media_id}/         ← replica folder
 *           original.wav
 *           transcript.txt
 *           info.json
 */
function scanDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('[scanner] Data directory not found, creating:', DATA_DIR);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return { projects: 0, characters: 0, replicas: 0 };
  }

  db.clearProjectData();

  const projectFolders = fs.readdirSync(DATA_DIR).filter(name => {
    const fullPath = path.join(DATA_DIR, name);
    return fs.statSync(fullPath).isDirectory();
  });

  let projectCount = 0;
  let characterCount = 0;
  let replicaCount = 0;

  for (const projectName of projectFolders) {
    const projectPath = path.join(DATA_DIR, projectName);

    // Upsert project
    db.upsertProject(projectName, projectPath);
    const project = db.getDb().prepare('SELECT id FROM projects WHERE name = ?').get(projectName);
    if (!project) continue;
    projectCount++;

    // Find character folders: any folder whose children are replica folders
    const entries = fs.readdirSync(projectPath).filter(name => {
      return fs.statSync(path.join(projectPath, name)).isDirectory();
    });

    // Determine if entries are character folders or directly replica folders
    // If an entry contains a sub-entity that looks like a replica folder → it's a character
    // Otherwise if it looks like a replica folder itself → flat structure (treat folder name as character)
    let characters = [];

    for (const entry of entries) {
      const entryPath = path.join(projectPath, entry);
      const subEntries = fs.readdirSync(entryPath).filter(n => {
        return fs.statSync(path.join(entryPath, n)).isDirectory();
      });

      if (subEntries.length > 0 && subEntries.some(n => isReplicaFolder(path.join(entryPath, n)))) {
        // entry IS a character folder
        characters.push({ name: entry, path: entryPath, replicaFolders: subEntries });
      } else if (isReplicaFolder(entryPath)) {
        // entry IS a replica folder — flat structure, use info.json character name
        // Group under same character later
        characters.push({ name: '_flat_', path: entryPath, replicaFolders: [entry] });
      } else if (subEntries.length > 0) {
        // Unknown structure — treat as character with sub-entries as replicas
        characters.push({ name: entry, path: entryPath, replicaFolders: subEntries });
      }
    }

    // Flatten: if there's a _flat_ entry, use info.json character field
    let charReplicas = []; // { charName, charPath, replicas: [{mediaId, path}] }

    for (const ch of characters) {
      if (ch.name === '_flat_') {
        // Read info.json from replica folder to get character name
        for (const rf of ch.replicaFolders) {
          const rfPath = path.join(ch.path, rf);
          const info = readInfoJson(rfPath);
          const charName = info.character || projectName;
          let cr = charReplicas.find(c => c.charName === charName);
          if (!cr) {
            cr = { charName, charPath: ch.path, replicas: [] };
            charReplicas.push(cr);
          }
          cr.replicas.push({ mediaId: rf, path: rfPath });
        }
      } else {
        let cr = charReplicas.find(c => c.charName === ch.name);
        if (!cr) {
          cr = { charName: ch.name, charPath: ch.path, replicas: [] };
          charReplicas.push(cr);
        }
        for (const rf of ch.replicaFolders) {
          cr.replicas.push({ mediaId: rf, path: path.join(ch.path, rf) });
        }
      }
    }

    // Insert into DB
    for (const cr of charReplicas) {
      const charFolderPath = cr.charPath;
      db.upsertCharacter(project.id, cr.charName, charFolderPath);
      const charRecord = db.getDb().prepare(
        'SELECT id FROM characters WHERE project_id = ? AND name = ?'
      ).get(project.id, cr.charName);
      if (!charRecord) continue;
      characterCount++;

      cr.replicas.sort((a, b) => a.mediaId.localeCompare(b.mediaId, 'ru', { numeric: true }));

      cr.replicas.forEach((rep, index) => {
        const audioFile = path.join(rep.path, 'original.wav');
        const transcriptFile = path.join(rep.path, 'transcript.txt');

        if (!fs.existsSync(audioFile)) {
          console.log(`[scanner] Skipping ${projectName}/${cr.charName}/${rep.mediaId}: no original.wav`);
          return;
        }

        const info = readInfoJson(rep.path);
        const duration = info.duration || 0;

        let transcript = '';
        let translation = '';
        if (fs.existsSync(transcriptFile)) {
          const parsed = parseReplicaTranscript(fs.readFileSync(transcriptFile, 'utf-8'));
          transcript = parsed.transcript;
          translation = parsed.translation;
        }

        if (!verifyWavHeader(audioFile)) {
          console.log(`[scanner] WARNING: ${projectName}/${cr.charName}/${rep.mediaId}/original.wav invalid`);
        }

        db.upsertReplica(
          charRecord.id,
          String(rep.mediaId),
          'original.wav',
          transcript,
          translation,
          audioFile,
          index,
          duration
        );
        replicaCount++;
      });
    }

    console.log(`[scanner] ${projectName}: ${charReplicas.length} characters, ${replicaCount} replicas`);
  }

  console.log(`[scanner] Done: ${projectCount} projects, ${characterCount} characters, ${replicaCount} replicas`);
  return { projects: projectCount, characters: characterCount, replicas: replicaCount };
}

function readInfoJson(replicaPath) {
  const infoFile = path.join(replicaPath, 'info.json');
  if (fs.existsSync(infoFile)) {
    try {
      return JSON.parse(fs.readFileSync(infoFile, 'utf-8'));
    } catch {}
  }
  return {};
}

module.exports = { scanDataDir, DATA_DIR, isReplicaFolder };
