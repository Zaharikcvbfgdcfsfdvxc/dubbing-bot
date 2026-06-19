const fs = require('fs');
const path = require('path');
const parseTranscriptText = require('../utils/transcriptParser');
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
 * Structure: data/{project}/transcript.txt + data/{project}/{character}/*.wav
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

  for (const projectName of projectFolders) {
    const projectPath = path.join(DATA_DIR, projectName);

    // Find transcript.txt
    const transcriptPath = path.join(projectPath, 'transcript.txt');
    let transcriptMap = new Map();
    if (fs.existsSync(transcriptPath)) {
      const text = fs.readFileSync(transcriptPath, 'utf-8');
      transcriptMap = parseTranscriptText(text);
      console.log(`[scanner] Parsed ${transcriptMap.size} entries from ${projectName}/transcript.txt`);
    } else {
      console.log(`[scanner] No transcript.txt in ${projectName}, skipping transcript parsing`);
    }

    // Upsert project
    db.upsertProject(projectName, projectPath);
    const project = db.getDb().prepare('SELECT id FROM projects WHERE name = ?').get(projectName);
    if (!project) continue;
    projectCount++;

    // Scan character subfolders
    const entries = fs.readdirSync(projectPath).filter(name => {
      const fullPath = path.join(projectPath, name);
      return fs.statSync(fullPath).isDirectory();
    });

    for (const characterName of entries) {
      const characterPath = path.join(projectPath, characterName);

      // Get WAV files
      const wavFiles = fs.readdirSync(characterPath).filter(f => /\.wav$/i.test(f));

      if (wavFiles.length === 0) {
        console.log(`[scanner] No WAV files in ${projectName}/${characterName}, skipping`);
        continue;
      }

      // Upsert character
      db.upsertCharacter(project.id, characterName, characterPath);
      const character = db.getDb().prepare(
        'SELECT id FROM characters WHERE project_id = ? AND name = ?'
      ).get(project.id, characterName);
      if (!character) continue;
      characterCount++;

      // Add replicas
      wavFiles.sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));

      wavFiles.forEach((filename, index) => {
        const filePath = path.join(characterPath, filename);
        const key = filename.replace(/\.wav$/i, '').toLowerCase();
        const info = transcriptMap.get(key) || transcriptMap.get(filename.toLowerCase()) || {};
        const isBroken = !verifyWavHeader(filePath);

        if (isBroken) {
          console.log(`[scanner] WARNING: ${filename} has invalid WAV header`);
        }

        db.upsertReplica(
          character.id,
          filename,
          info.transcript || '',
          info.translation || '',
          filePath,
          index
        );
        replicaCount++;
      });

      console.log(`[scanner] ${projectName}/${characterName}: ${wavFiles.length} replicas`);
    }
  }

  console.log(`[scanner] Done: ${projectCount} projects, ${characterCount} characters, ${replicaCount} replicas`);
  return { projects: projectCount, characters: characterCount, replicas: replicaCount };
}

module.exports = { scanDataDir, DATA_DIR };
