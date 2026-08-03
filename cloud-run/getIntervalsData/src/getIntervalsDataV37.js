import { buildIntervalsUrl, mergeIntervalsData } from './getIntervalsDataV35.js';
import { WELLNESS_COLS } from './getIntervalsDataV36.js';

const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const DEFAULT_OLDEST = '2026-02-10';

export async function handleGetIntervalsData(req, res, options = {}) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  try {
    const requestUrl = new URL(req.url || '/', 'https://procoach.local');
    const config = readConfig(requestUrl);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const debug = requestUrl.searchParams.get('debug') === '1';

    if (!fetchImpl) throw new Error('Fetch API is not available');
    if (!config.athleteId) throw new Error('Missing INTERVALS_ATHLETE_ID');
    if (!config.apiKey && !config.basicAuth && !config.bearerToken) throw new Error('Missing Intervals authentication');

    const activityUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/activities`, {
      oldest: config.oldest,
      newest: config.newest
    });
    const wellnessCsvUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/wellness.csv`, {
      oldest: config.oldest,
      newest: config.newest,
      cols: WELLNESS_COLS
    });
    const wellnessJsonUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/wellness`, {
      oldest: config.oldest,
      newest: config.newest
    });

    const activities = ensureArray(await fetchJson(fetchImpl, activityUrl, config));

    let wellness = [];
    let wellnessFetchMode = 'csv-explicit-cols';
    let wellnessError = null;
    try {
      const csv = await fetchText(fetchImpl, wellnessCsvUrl, config);
      wellness = parseCsv(csv);
      if (!wellness.length) throw new Error('Wellness CSV returned no rows');
    } catch (error) {
      wellnessError = error.message;
      wellnessFetchMode = 'json-fallback';
      wellness = ensureArray(await fetchJson(fetchImpl, wellnessJsonUrl, config));
    }

    const days = mergeIntervalsData({ activities, wellness, debug }).map(day => ({
      ...day,
      source: 'intervals-merged-v37',
      wellnessFetchMode
    }));

    console.log(JSON.stringify({ severity: 'INFO', message: 'Intervals fetch complete', mode: 'daily-merged-v37', wellnessFetchMode, activitiesCount: activities.length, wellnessRecordsCount: wellness.length, daysCount: days.length, wellnessError }));
    sendJson(res, 200, days);
  } catch (error) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'Intervals fetch failed', error: error.message, stack: error.stack }));
    sendJson(res, 500, { error: error.message });
  }
}

export function parseCsv(text) {
  const rows = parseCsvRows(String(text || '').replace(/^\uFEFF/, ''));
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(row => row.some(cell => cell !== '')).map(row => {
    const record = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const raw = row[index] ?? '';
      record[header === 'date' ? 'id' : header] = coerceCsvValue(raw);
    });
    return record;
  });
}

function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function coerceCsvValue(value) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text;
}

function readConfig(requestUrl) {
  const newest = requestUrl.searchParams.get('newest') || new Date().toISOString().slice(0, 10);
  return {
    baseUrl: process.env.INTERVALS_BASE_URL || DEFAULT_BASE_URL,
    athleteId: clean(process.env.INTERVALS_ATHLETE_ID || process.env.ATHLETE_ID),
    apiKey: clean(process.env.INTERVALS_API_KEY || process.env.API_KEY),
    basicAuth: clean(process.env.INTERVALS_BASIC_AUTH || process.env.BASIC_AUTH),
    bearerToken: clean(process.env.INTERVALS_BEARER_TOKEN || process.env.INTERVALS_TOKEN),
    oldest: requestUrl.searchParams.get('oldest') || process.env.INTERVALS_OLDEST || DEFAULT_OLDEST,
    newest
  };
}

async function fetchJson(fetchImpl, url, config) { const text = await fetchText(fetchImpl, url, config); return text ? JSON.parse(text) : []; }
async function fetchText(fetchImpl, url, config) {
  const response = await fetchImpl(url, { headers: authHeaders(config) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Intervals API ${url.pathname} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}
function authHeaders(config) {
  if (config.bearerToken) return { Authorization: `Bearer ${config.bearerToken}`, Accept: '*/*' };
  if (config.basicAuth) return { Authorization: config.basicAuth.startsWith('Basic ') ? config.basicAuth : `Basic ${config.basicAuth}`, Accept: '*/*' };
  return { Authorization: `Basic ${Buffer.from(`API_KEY:${config.apiKey}`, 'utf8').toString('base64')}`, Accept: '*/*' };
}
function ensureArray(payload) { if (Array.isArray(payload)) return payload; if (payload && Array.isArray(payload.activities)) return payload.activities; if (payload && Array.isArray(payload.items)) return payload.items; if (payload && Array.isArray(payload.data)) return payload.data; if (payload && Array.isArray(payload.wellness)) return payload.wellness; if (payload && typeof payload === 'object') return [payload]; return []; }
function clean(value) { return typeof value === 'string' ? value.trim() : value; }
function setCorsHeaders(res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Cache-Control', 'no-store'); }
function sendJson(res, status, payload) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); }
