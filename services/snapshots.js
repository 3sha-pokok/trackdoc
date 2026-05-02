import fs from 'fs/promises';
import path from 'path';

const SNAPSHOT_DIR = path.join(process.cwd(), 'snapshots');

/**
 * Saves a snapshot of the document text associated with a revision ID.
 * @param {string} docId - The Google Doc ID.
 * @param {string} revisionId - The Google Drive revision ID.
 * @param {string} content - The plain text content of the doc.
 */
export async function saveSnapshot(docId, revisionId, content) {
  const docDir = path.join(SNAPSHOT_DIR, docId);
  await fs.mkdir(docDir, { recursive: true });

  const filePath = path.join(docDir, `${revisionId}.txt`);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Retrieves the content of a specific snapshot.
 * @param {string} docId - The Google Doc ID.
 * @param {string} revisionId - The Google Drive revision ID.
 */
export async function getSnapshot(docId, revisionId) {
  const filePath = path.join(SNAPSHOT_DIR, docId, `${revisionId}.txt`);
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Gets the most recent snapshot for a document.
 * @param {string} docId - The Google Doc ID.
 */
export async function getLastSnapshot(docId) {
  const docDir = path.join(SNAPSHOT_DIR, docId);
  try {
    const files = await fs.readdir(docDir);
    if (files.length === 0) return null;

    // Sort files to get the latest one (assuming we can't rely on filename sorting)
    // In a real DB, we'd use a timestamp. Here we just take the last one created.
    const latestFile = files[files.length - 1];
    return await fs.readFile(path.join(docDir, latestFile), 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Lists all available snapshots for a document.
 * @param {string} docId - The Google Doc ID.
 */
export async function listSnapshots(docId) {
  const docDir = path.join(SNAPSHOT_DIR, docId);
  try {
    return await fs.readdir(docDir);
  } catch (e) {
    return [];
  }
}
