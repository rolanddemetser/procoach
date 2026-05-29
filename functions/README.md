# Firebase Function getIntervalsData

This folder replaces the failed Cloud Run service with a Firebase HTTPS Function named `getIntervalsData`.

## Files to deploy

Use these as the full replacements in your Firebase functions source folder:

- `index.js`
- `package.json`

There is intentionally no Dockerfile and no Cloud Run service.

## Intervals endpoints

Activities stay on the existing endpoint:

```text
GET https://intervals.icu/api/v1/athlete/{athleteId}/activities?oldest={YYYY-MM-DD}&newest={YYYY-MM-DD}
```

Wellness/vitals are fetched from:

```text
GET https://intervals.icu/api/v1/athlete/{athleteId}/wellness?oldest={YYYY-MM-DD}&newest={YYYY-MM-DD}
```

Example wellness record:

```json
{
  "id": "2026-05-28",
  "sleepTime": 27000,
  "restingHR": 52,
  "hrv": 41,
  "weight": 93.2
}
```

## Deploy steps

From the repo root, install dependencies once:

```bash
cd functions
npm install
cd ..
```

Gen1 replacement of the existing `getIntervalsData` function, using classic Firebase runtime config:

```bash
firebase functions:config:set intervals.athlete_id="YOUR_ATHLETE_ID" intervals.api_key="YOUR_INTERVALS_API_KEY" --project YOUR_FIREBASE_PROJECT_ID
firebase deploy --only functions:getIntervalsData --project YOUR_FIREBASE_PROJECT_ID
```

Gen1 can also use environment variables or `functions/.env` instead of `functions:config`:

```bash
cat > functions/.env <<'ENV'
INTERVALS_ATHLETE_ID=YOUR_ATHLETE_ID
INTERVALS_API_KEY=YOUR_INTERVALS_API_KEY
ENV
firebase deploy --only functions:getIntervalsData --project YOUR_FIREBASE_PROJECT_ID
```

For a Gen2 deployment of the same function name, use environment variables or `functions/.env` and set `FUNCTIONS_GEN=2` during deploy trigger discovery:

```bash
cat > functions/.env <<'ENV'
INTERVALS_ATHLETE_ID=YOUR_ATHLETE_ID
INTERVALS_API_KEY=YOUR_INTERVALS_API_KEY
ENV
FUNCTIONS_GEN=2 firebase deploy --only functions:getIntervalsData --project YOUR_FIREBASE_PROJECT_ID
```
