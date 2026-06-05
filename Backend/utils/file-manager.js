/**
 * @file utils/file-manager.js
 * @description JSON profile file operations: list, read, write, exists, and
 *              directory creation. All profile I/O goes through here so paths
 *              and JSON formatting stay consistent.
 */

import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { CONSTANTS } from '../config/constants.js';

/**
 * Ensure a directory exists (recursive). Synchronous because it's used in
 * setup paths and is cheap.
 * @param {string} dir
 */
export function ensureDirSync(dir) {
  if (!fssync.existsSync(dir)) {
    fssync.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensure a directory exists (async).
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * List all profile JSON filenames in the profiles directory.
 * @returns {Promise<string[]>} Filenames (e.g. ["profile_101lab.json"]).
 */
export async function listProfileFiles() {
  await ensureDir(CONSTANTS.PROFILES_DIR);
  const entries = await fs.readdir(CONSTANTS.PROFILES_DIR);
  return entries.filter(
    (f) => f.endsWith('.json') && f !== 'template.json',
  );
}

/**
 * Read and parse a profile JSON file by filename.
 * @param {string} fileName - e.g. "profile_101lab.json".
 * @returns {Promise<object>} Parsed profile.
 */
export async function readProfile(fileName) {
  const full = path.join(CONSTANTS.PROFILES_DIR, fileName);
  const content = await fs.readFile(full, 'utf8');
  return JSON.parse(content);
}

/**
 * Read every profile, returning { fileName, profile } pairs. Skips files that
 * fail to parse (and reports them).
 * @returns {Promise<Array<{ fileName: string, profile: object }>>}
 */
export async function readAllProfiles() {
  const files = await listProfileFiles();
  const results = [];
  for (const fileName of files) {
    try {
      const profile = await readProfile(fileName);
      results.push({ fileName, profile });
    } catch (err) {
      // Surface parse errors but keep going.
      results.push({ fileName, profile: null, error: err.message });
    }
  }
  return results;
}

/**
 * Write a profile object to disk as pretty JSON.
 * @param {string} fileName
 * @param {object} profile
 * @returns {Promise<string>} The full path written.
 */
export async function writeProfile(fileName, profile) {
  await ensureDir(CONSTANTS.PROFILES_DIR);
  const full = path.join(CONSTANTS.PROFILES_DIR, fileName);
  await fs.writeFile(full, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  return full;
}

/**
 * Check whether a profile file exists.
 * @param {string} fileName
 * @returns {boolean}
 */
export function profileExists(fileName) {
  return fssync.existsSync(path.join(CONSTANTS.PROFILES_DIR, fileName));
}

/**
 * Delete a profile file. Resolves quietly if it's already gone.
 * @param {string} fileName
 * @returns {Promise<void>}
 */
export async function deleteProfile(fileName) {
  const full = path.join(CONSTANTS.PROFILES_DIR, fileName);
  await fs.rm(full, { force: true });
}

/**
 * Read a text file relative to project root.
 * @param {string} relativePath
 * @returns {Promise<string>}
 */
export async function readTextFile(relativePath) {
  const full = path.resolve(CONSTANTS.PROFILES_DIR, '..', relativePath);
  return fs.readFile(full, 'utf8');
}

export default {
  ensureDir,
  ensureDirSync,
  listProfileFiles,
  readProfile,
  readAllProfiles,
  writeProfile,
  profileExists,
  deleteProfile,
  readTextFile,
};
