/**
 * @file controllers/profiles.controller.js — /api/profiles and friends.
 */
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { isValidUrl, validateProfile } from '../utils/validators.js';
import {
  readAllProfiles,
  readProfile,
  writeProfile,
  profileExists,
  deleteProfile,
} from '../utils/file-manager.js';
import { getLastCrawlTimes } from '../database/queries.js';
import { startCrawlJob } from '../services/crawlJob.js';

/** Next scheduled crawl time for the global cron `0 *\/N * * *`. */
function computeNextRun() {
  const interval = Math.max(1, CONSTANTS.CRAWL_INTERVAL_HOURS || 2);
  const now = new Date();
  for (let h = 0; h < 24; h += interval) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).toISOString();
}

/** Settings the Profiles page is allowed to change on an existing profile. */
const EDITABLE_SETTINGS = ['scrapeMode', 'scrapeLimit', 'downloadImages', 'paused'];

/** GET /api/profiles */
export async function listProfiles(req, res) {
  const all = await readAllProfiles();

  const lastByUrl = new Map();
  try {
    for (const row of await getLastCrawlTimes()) {
      lastByUrl.set(row.listing_url, row.last_timestamp);
    }
  } catch (err) {
    logger.warn(`Could not load crawl times for profiles: ${err.message}`);
  }
  const nextRun = computeNextRun();

  const profiles = all
    .filter((e) => e.profile)
    .map(({ fileName, profile }) => {
      const listingUrls = Array.isArray(profile.listingUrls) ? profile.listingUrls : [];
      const paused = !!profile.paused;
      const scrapeMode = profile.scrapeMode || null;

      let lastScrapedAt = null;
      for (const url of listingUrls) {
        const ts = lastByUrl.get(url);
        if (ts && (!lastScrapedAt || new Date(ts) > new Date(lastScrapedAt))) lastScrapedAt = ts;
      }

      return {
        fileName,
        profileId: profile.profileId,
        profileName: profile.profileName,
        domain: profile.domain,
        source: profile.source || 'dom',
        scrapeMode,
        scrapeLimit: profile.scrapeLimit ?? null,
        downloadImages: !!profile.downloadImages,
        paused,
        urlPattern: profile.urlPattern,
        listingUrls,
        fieldCount: profile.fields ? Object.keys(profile.fields).length : 0,
        hasImages: !!(profile.selectors && profile.selectors.images),
        updatedAt: profile.updatedAt || null,
        lastScrapedAt,
        nextScrapeAt: scrapeMode === 'auto' && !paused ? nextRun : null,
      };
    });
  res.json({ profiles });
}

/** GET /api/profile?fileName= — full saved profile config (for editing in the Studio). */
export async function getProfileConfig(req, res) {
  const raw = req.query.fileName;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'fileName required.' });
  }
  const fn = raw.endsWith('.json') ? raw : `${raw}.json`;
  if (!(await profileExists(fn))) {
    return res.status(404).json({ error: `Profile not found: ${fn}` });
  }
  const config = await readProfile(fn);
  res.json({ fileName: fn, config });
}

/** POST /api/save-profile { fileName, profile, runNow? } */
export async function saveProfile(req, res) {
  const body = req.body || {};
  let { fileName } = body;
  const { profile } = body;
  if (!profile || typeof profile !== 'object') {
    return res.status(400).json({ error: 'Missing profile object.' });
  }
  delete profile._suggestedFileName;
  profile.updatedAt = new Date().toISOString();

  const { valid, errors } = validateProfile(profile);
  if (!valid) {
    return res.status(400).json({ error: 'Profile invalid', details: errors });
  }

  if (!fileName) {
    const slug = (profile.domain || 'site').replace(/[^a-z0-9]+/gi, '').toLowerCase();
    fileName = `profile_${slug}.json`;
  }
  if (!fileName.endsWith('.json')) fileName += '.json';

  const overwrote = await profileExists(fileName);
  const full = await writeProfile(fileName, profile);
  logger.success(`Profile saved via UI: ${full}`);

  const listingUrls = Array.isArray(profile.listingUrls)
    ? profile.listingUrls.filter(isValidUrl)
    : [];
  const runNow = body.runNow !== false && listingUrls.length > 0;
  const jobId = runNow ? startCrawlJob(listingUrls) : null;

  res.json({ ok: true, fileName, overwrote, path: full, runStarted: !!jobId, jobId });
}

/** POST /api/profile-settings { fileName, settings } — partial settings update. */
export async function updateSettings(req, res) {
  const body = req.body || {};
  const { fileName, settings } = body;
  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ error: 'fileName required.' });
  }
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings object required.' });
  }
  const fn = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
  if (!(await profileExists(fn))) {
    return res.status(404).json({ error: `Profile not found: ${fn}` });
  }

  const profile = await readProfile(fn);

  if ('scrapeMode' in settings) {
    if (settings.scrapeMode !== 'auto' && settings.scrapeMode !== 'manual') {
      return res.status(400).json({ error: "scrapeMode must be 'auto' or 'manual'." });
    }
    profile.scrapeMode = settings.scrapeMode;
  }
  if ('scrapeLimit' in settings) {
    const v = settings.scrapeLimit;
    if (v === null || v === '') {
      profile.scrapeLimit = null;
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({ error: 'scrapeLimit must be a positive integer or null.' });
      }
      profile.scrapeLimit = n;
    }
  }
  if ('downloadImages' in settings) profile.downloadImages = !!settings.downloadImages;
  if ('paused' in settings) profile.paused = !!settings.paused;

  const unknown = Object.keys(settings).filter((k) => !EDITABLE_SETTINGS.includes(k));
  if (unknown.length) logger.warn(`Ignored non-editable profile settings: ${unknown.join(', ')}`);

  profile.updatedAt = new Date().toISOString();
  await writeProfile(fn, profile);
  logger.success(`Profile settings updated via UI: ${fn}`);

  res.json({
    ok: true,
    fileName: fn,
    settings: {
      scrapeMode: profile.scrapeMode || null,
      scrapeLimit: profile.scrapeLimit ?? null,
      downloadImages: !!profile.downloadImages,
      paused: !!profile.paused,
    },
  });
}

/** POST /api/delete-profile { fileName } */
export async function removeProfile(req, res) {
  const { fileName } = req.body || {};
  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ error: 'fileName required.' });
  }
  const fn = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
  if (!(await profileExists(fn))) {
    return res.status(404).json({ error: `Profile not found: ${fn}` });
  }
  await deleteProfile(fn);
  logger.success(`Profile deleted via UI: ${fn}`);
  res.json({ ok: true, fileName: fn });
}

/** POST /api/run-profile { fileName } — crawl this profile's listing URL(s) now. */
export async function runProfile(req, res) {
  const { fileName } = req.body || {};
  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({ error: 'fileName required.' });
  }
  const fn = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
  if (!(await profileExists(fn))) {
    return res.status(404).json({ error: `Profile not found: ${fn}` });
  }
  const profile = await readProfile(fn);
  const listingUrls = (Array.isArray(profile.listingUrls) ? profile.listingUrls : []).filter(
    isValidUrl,
  );
  if (!listingUrls.length) {
    return res.status(400).json({
      error: 'This profile has no listingUrls to crawl. Re-build it in the Mapping Studio.',
    });
  }
  const jobId = startCrawlJob(listingUrls);
  res.json({ ok: true, runStarted: true, fileName: fn, listingUrls, jobId });
}
