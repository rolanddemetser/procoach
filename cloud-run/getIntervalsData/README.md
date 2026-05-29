# getIntervalsData Cloud Run service

Backend-only ProCoach sync service for Intervals.icu.

## Intervals endpoints used

The existing activities sync keeps using:

```text
GET https://intervals.icu/api/v1/athlete/{athleteId}/activities?oldest={YYYY-MM-DD}&newest={YYYY-MM-DD}
```

Wellness/vitals are fetched from the Intervals.icu wellness range endpoint:

```text
GET https://intervals.icu/api/v1/athlete/{athleteId}/wellness?oldest={YYYY-MM-DD}&newest={YYYY-MM-DD}
```

The single-day equivalent documented and discussed by Intervals users is:

```text
GET https://intervals.icu/api/v1/athlete/{athleteId}/wellness/{YYYY-MM-DD}
```

## Example wellness payload

A typical wellness record contains one calendar day with keys such as `id`, `sleepTime`, `restingHR`, `hrv`, and `weight`:

```json
{
  "id": "2026-05-28",
  "sleepTime": 27000,
  "restingHR": 52,
  "hrv": 41,
  "weight": 93.2
}
```

The service appends normalized wellness objects to the unchanged activities array. That preserves the current ProCoach top-level array payload while making `sleepHours`, `rhr`, `hrv_rmssd`, and `weight` available to the existing classifier.

## Configuration

Required environment variables:

- `INTERVALS_ATHLETE_ID` or `ATHLETE_ID`
- `INTERVALS_API_KEY` or `API_KEY`; alternatively `INTERVALS_BEARER_TOKEN` or `INTERVALS_TOKEN`

Optional environment variables:

- `INTERVALS_BASE_URL` defaults to `https://intervals.icu/api/v1`
- `INTERVALS_OLDEST` defaults to `2026-02-10`
- `INTERVALS_DAYS` can derive `oldest` from `newest` when `INTERVALS_OLDEST` is not set

Request query parameters `oldest` and `newest` override the date range for both activities and wellness.
