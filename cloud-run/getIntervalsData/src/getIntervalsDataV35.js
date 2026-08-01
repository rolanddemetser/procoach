const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const DEFAULT_OLDEST = '2026-02-10';
const MS_PER_DAY = 86400000;

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

    const activityUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/activities`, { oldest: config.oldest, newest: config.newest });
    const wellnessUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/wellness`, { oldest: config.oldest, newest: config.newest });

    const activities = ensureArray(await fetchJson(fetchImpl, activityUrl, config));
    let rangeWellness = [];
    let wellnessError = null;
    try { rangeWellness = ensureArray(await fetchJson(fetchImpl, wellnessUrl, config)); }
    catch (error) { wellnessError = error.message; }

    const detailWellness = await fetchRecentWellnessDetails(fetchImpl, config);
    const wellness = mergeWellnessRecords(rangeWellness, detailWellness);
    const days = mergeIntervalsData({ activities, wellness, debug });

    console.log(JSON.stringify({ severity: 'INFO', message: 'Intervals fetch complete', mode: 'daily-merged-v35', activitiesCount: activities.length, wellnessRecordsCount: wellness.length, detailRecordsCount: detailWellness.length, daysCount: days.length, wellnessError }));
    sendJson(res, 200, days);
  } catch (error) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'Intervals fetch failed', error: error.message, stack: error.stack }));
    sendJson(res, 500, { error: error.message });
  }
}

export function mergeIntervalsData({ activities = [], wellness = [], debug = false }) {
  const byDate = new Map();

  for (const record of wellness) {
    const date = normalDate(firstString(record, ['date', 'day', 'start_date', 'startDate', 'id']));
    if (!date) continue;
    const day = ensureDay(byDate, date);
    day.hasWellness = true;

    const stepCandidates = extractStepCandidates(record);
    if (stepCandidates.length) {
      day.stepCandidates.push(...stepCandidates.map(c => ({ ...c, recordType: 'wellness', recordDate: date })));
      const best = chooseBestStepCandidate(day.stepCandidates);
      day.steps = best.value;
      day.stepsSource = best.path;
      day.stepsRecordType = best.recordType || 'wellness';
    }

    const sleepRaw = firstNumber(record, ['sleepTime','sleepSecs','sleepSeconds','sleepDuration','sleepDurationSeconds','sleep','sleep_hours','sleep_duration_hours','sleep_seconds','sleep.minutes','sleep_minutes','sleep.seconds','sleep.duration','sleep.total','sleep_duration','total_sleep']);
    const sleepHours = normalizeSleepHours(sleepRaw);
    if (sleepHours !== null) { day.sleepHours = sleepHours; day.sleep_duration = sleepHours; day.sleep_duration_hours = sleepHours; }

    const rhr = firstNumber(record, ['restingHR','restingHr','resting_hr','resting_heart_rate','resting_heartrate','rhr']);
    if (rhr !== null) { day.rhr = rhr; day.resting_hr = rhr; }

    const bb = extractBodyBatteryCandidate(record);
    if (bb.value !== null) {
      day.bodyBattery = bb.value;
      day.body_battery = bb.value;
      day.bodyBatteryMorning = true;
      day.bodyBatterySourcePath = bb.path;
    }

    const hrv = firstNumber(record, ['hrv','hrvRMSSD','hrvRmssd','hrv_rmssd','rmssd']);
    if (hrv !== null) { day.hrv = hrv; day.hrv_rmssd = hrv; }
    const weight = firstNumber(record, ['weight','weightKg','weight_kg']);
    if (weight !== null) day.weight = weight;

    if (debug) { day.debugWellnessKeys = Object.keys(record).slice(0, 120); day.debugWellnessNumeric = numericSnapshot(record); }
  }

  for (const activity of activities) {
    const date = normalDate(firstString(activity, ['start_date_local','start_date','date','calendar_date','day']));
    if (!date) continue;
    const day = ensureDay(byDate, date);
    day.hasActivities = true;
    const min = activityMinutes(activity);
    const name = String(firstString(activity, ['name','type','sport','activity_type']) || '').toLowerCase();
    const type = String(firstString(activity, ['type','sport','activity_type']) || '').toLowerCase();
    const isWalk = type.includes('walk') || name.includes('walk') || name.includes('wandel') || type.includes('hike') || name.includes('hike');
    const isStrength = type.includes('strength') || name.includes('kracht') || name.includes('strength') || name.includes('workout');
    const isYoga = type.includes('yoga') || name.includes('yoga') || name.includes('mobiliteit') || name.includes('mobility');
    if (min > 0 && isWalk && min >= 20 && min <= 180) { day.walkMin += min; day.activityMin += min; }
    else if (min > 0 && isStrength) { day.strengthMin += min; day.activityMin += min; }
    else if (min > 0 && isYoga) { day.yogaMin += min; day.activityMin += min; }
    const distanceKm = firstNumber(activity, ['distance','distance_km']);
    if (distanceKm !== null) day.distanceKm += distanceKm > 1000 ? distanceKm / 1000 : distanceKm;
    const load = firstNumber(activity, ['icu_training_load','training_load','load']);
    if (load !== null) day.load += load;
  }

  return [...byDate.values()].map(finalizeDay).sort((a,b) => a.date.localeCompare(b.date));
}

function emptyDay(date) {
  return { date, start_date_local: date, calendar_date: date, day: date, source: 'intervals-merged-v35', hasWellness: false, hasActivities: false, steps: null, stepsSource: '', stepsRecordType: '', stepCandidates: [], walkMin: 0, activityMin: 0, strengthMin: 0, yogaMin: 0, distanceKm: 0, load: 0, sleepHours: null, sleep_duration: null, sleep_duration_hours: null, rhr: null, resting_hr: null, bodyBattery: null, body_battery: null, bodyBatteryMorning: false, bodyBatterySourcePath: '' };
}
function ensureDay(map, date) { if (!map.has(date)) map.set(date, emptyDay(date)); return map.get(date); }
function finalizeDay(day) {
  day.walkMin = Math.round(day.walkMin); day.activityMin = Math.round(day.activityMin); day.strengthMin = Math.round(day.strengthMin); day.yogaMin = Math.round(day.yogaMin); day.distanceKm = Math.round(day.distanceKm * 100) / 100; day.load = Math.round(day.load);
  day.stepsStatus = day.steps === null ? 'missing' : (day.steps < 9000 ? 'low' : 'ok');
  day.stepCandidates = day.stepCandidates.sort((a,b) => b.value - a.value).slice(0, 20);
  return day;
}

async function fetchRecentWellnessDetails(fetchImpl, config) {
  const records = [];
  for (const date of recentIsoDates(config.newest, 4)) {
    const url = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/wellness/${date}`, {});
    try {
      const record = await fetchJson(fetchImpl, url, config);
      if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record);
    } catch (error) {
      console.log(JSON.stringify({ severity: 'INFO', message: 'Recent wellness detail unavailable', date, error: error.message }));
    }
  }
  return records;
}
function recentIsoDates(endDate, count) { const end = new Date(`${endDate}T12:00:00Z`); if (Number.isNaN(end.getTime())) return []; return Array.from({length:count}, (_,i) => new Date(end.getTime() - i * MS_PER_DAY).toISOString().slice(0,10)); }
function mergeWellnessRecords(rangeRecords, detailRecords) {
  const map = new Map();
  for (const record of [...rangeRecords, ...detailRecords]) {
    const date = normalDate(firstString(record, ['date','day','start_date','startDate','id']));
    if (!date) continue;
    map.set(date, mergeDefined(map.get(date) || {}, record));
  }
  return [...map.values()];
}
function mergeDefined(previous, incoming) { const result = { ...previous }; for (const [key,value] of Object.entries(incoming || {})) if (value !== undefined && value !== null && value !== '') result[key] = value; return result; }

function extractStepCandidates(record) {
  const candidates = [];
  const paths = ['wellness.steps','wellness.Steps','wellness.stepCount','wellness.step_count','wellness.totalSteps','wellness.total_steps','steps','Steps','stepCount','step_count','totalSteps','total_steps','dailySteps','daily_steps'];
  for (const path of paths) { const value = parseFiniteNumber(valueAt(record, path)); if (value !== null && value >= 0 && value < 100000) candidates.push({ path, value }); }
  collectStepCandidates(record, '', candidates, 0);
  const seen = new Set();
  return candidates.filter(c => { const id = `${c.path}:${c.value}`; if (seen.has(id)) return false; seen.add(id); return true; }).sort((a,b) => b.value - a.value || stepPathPriority(b.path) - stepPathPriority(a.path));
}
function collectStepCandidates(value, prefix, out, depth) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) { value.slice(0,300).forEach((child,i) => collectStepCandidates(child, `${prefix}[${i}]`, out, depth + 1)); return; }
  for (const [key,child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const normalized = key.toLowerCase().replace(/[^a-z]/g,'');
    if (['steps','stepcount','totalsteps','dailysteps'].includes(normalized)) { const n = parseFiniteNumber(child); if (n !== null && n >= 0 && n < 100000) out.push({ path, value: n }); }
    if (child && typeof child === 'object') collectStepCandidates(child, path, out, depth + 1);
  }
}
function chooseBestStepCandidate(candidates) { return candidates.filter(c => Number.isFinite(c.value) && c.value >= 0 && c.value < 100000).sort((a,b) => b.value - a.value || stepPathPriority(b.path) - stepPathPriority(a.path))[0] || { path:'', value:null, recordType:'' }; }
function stepPathPriority(path='') { return /dailySteps|daily_steps|totalSteps|total_steps|stepCount|step_count|wellness\.steps/i.test(path) ? 2 : 1; }

function extractBodyBatteryCandidate(record) {
  const candidates = [];
  for (const path of ['body_battery_morning','morning_body_battery','bodyBatteryMorning','body_battery','bodyBattery']) { const value = parseFiniteNumber(valueAt(record, path)); if (value !== null && value >= 0 && value <= 100) candidates.push({ path, value, priority: /morning/i.test(path) ? 3 : 2 }); }
  collectBodyBatteryCandidates(record, '', candidates, 0);
  candidates.sort((a,b) => b.value - a.value || b.priority - a.priority);
  return candidates[0] || { path:'', value:null, priority:0 };
}
function collectBodyBatteryCandidates(value, prefix, out, depth) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) { value.slice(0,300).forEach((child,i) => collectBodyBatteryCandidates(child, `${prefix}[${i}]`, out, depth + 1)); return; }
  for (const [key,child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const normalized = key.toLowerCase().replace(/[^a-z]/g,'');
    if (normalized.includes('bodybattery')) { const n = parseFiniteNumber(child); if (n !== null && n >= 0 && n <= 100) out.push({ path, value:n, priority: normalized.includes('morning') || normalized.includes('max') ? 3 : 1 }); }
    if (child && typeof child === 'object') collectBodyBatteryCandidates(child, path, out, depth + 1);
  }
}

export function buildIntervalsUrl(baseUrl, path, params) { const url = new URL(`${baseUrl.replace(/\/$/,'')}${path}`); for (const [key,value] of Object.entries(params || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key,value); return url; }
function readConfig(requestUrl) {
  const newest = requestUrl.searchParams.get('newest') || todayIsoDate();
  const oldest = requestUrl.searchParams.get('oldest') || process.env.INTERVALS_OLDEST || daysAgoIsoDate(Number(process.env.INTERVALS_DAYS || 0), newest) || DEFAULT_OLDEST;
  return { baseUrl: process.env.INTERVALS_BASE_URL || DEFAULT_BASE_URL, athleteId: clean(process.env.INTERVALS_ATHLETE_ID || process.env.ATHLETE_ID), apiKey: clean(process.env.INTERVALS_API_KEY || process.env.API_KEY), basicAuth: clean(process.env.INTERVALS_BASIC_AUTH || process.env.BASIC_AUTH), bearerToken: clean(process.env.INTERVALS_BEARER_TOKEN || process.env.INTERVALS_TOKEN), oldest, newest };
}
async function fetchJson(fetchImpl, url, config) { const response = await fetchImpl(url, { headers: authHeaders(config) }); const text = await response.text(); if (!response.ok) throw new Error(`Intervals API ${url.pathname} returned HTTP ${response.status}: ${text.slice(0,300)}`); return text ? JSON.parse(text) : []; }
function authHeaders(config) { if (config.bearerToken) return { Authorization:`Bearer ${config.bearerToken}`, Accept:'application/json' }; if (config.basicAuth) return { Authorization: config.basicAuth.startsWith('Basic ') ? config.basicAuth : `Basic ${config.basicAuth}`, Accept:'application/json' }; return { Authorization:`Basic ${Buffer.from(`API_KEY:${config.apiKey}`,'utf8').toString('base64')}`, Accept:'application/json' }; }
function clean(value) { return typeof value === 'string' ? value.trim() : value; }
function ensureArray(payload) { if (Array.isArray(payload)) return payload; if (payload && Array.isArray(payload.activities)) return payload.activities; if (payload && Array.isArray(payload.items)) return payload.items; if (payload && Array.isArray(payload.data)) return payload.data; if (payload && Array.isArray(payload.wellness)) return payload.wellness; if (payload && typeof payload === 'object') return [payload]; return []; }
function normalizeSleepHours(value) { if (value === null || value === undefined) return null; return value > 24 ? Math.round((value / 3600) * 100) / 100 : value; }
function firstString(record, keys) { for (const key of keys) { const value = valueAt(record,key); if (typeof value === 'string' && value) return value; if (typeof value === 'number' && Number.isFinite(value)) return String(value); } return null; }
function firstNumber(record, keys) { for (const key of keys) { const value = parseFiniteNumber(valueAt(record,key)); if (value !== null) return value; } return null; }
function parseFiniteNumber(value) { if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value); return null; }
function valueAt(record,path) { if (!record || typeof record !== 'object') return undefined; let current = record; for (const part of path.split('.')) { if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current,part)) return undefined; current = current[part]; } return current; }
function activityMinutes(activity) { const raw = firstNumber(activity,['moving_time','elapsed_time','duration','minutes']); if (raw === null) return 0; let mins = raw; if (raw > 600) mins = Math.round(raw / 60); if (mins > 600) return 0; return Math.round(mins); }
function normalDate(value) { if (value === null || value === undefined || value === '') return null; const s = String(value).trim(); const match = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); if (match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`; const dt = new Date(s); return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0,10); }
function numericSnapshot(record,prefix='',out=[]) { if (!record || typeof record !== 'object') return out; if (Array.isArray(record)) { record.slice(0,300).forEach((v,i) => numericSnapshot(v,`${prefix}[${i}]`,out)); return out; } for (const [key,value] of Object.entries(record)) { const path = prefix ? `${prefix}.${key}` : key; const n = parseFiniteNumber(value); if (n !== null) out.push({path,value:n}); if (value && typeof value === 'object') numericSnapshot(value,path,out); } return out.slice(0,300); }
function todayIsoDate() { return new Date().toISOString().slice(0,10); }
function daysAgoIsoDate(days,newest) { if (!Number.isFinite(days) || days <= 0) return null; const date = new Date(`${newest}T12:00:00Z`); if (Number.isNaN(date.getTime())) return null; return new Date(date.getTime() - days * MS_PER_DAY).toISOString().slice(0,10); }
function setCorsHeaders(res) { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); res.setHeader('Cache-Control','no-store'); }
function sendJson(res,status,payload) { res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); }
