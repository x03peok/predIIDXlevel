# CPI:Next data contribution endpoint

This Apps Script web app accepts one consented, latest-only snapshot containing both AC and INFINITAS clear statuses. It does not store Preds, feature values, names, IIDX IDs, memos, options, daily targets, or update history.

## Setup

1. Create a private Google Drive folder for contribution JSON files. Do not share it publicly.
2. Create a Google Apps Script project and paste `Code.gs` into it.
3. In **Project Settings → Script properties**, set:
   - `DRIVE_FOLDER_ID`: the ID from the private Drive folder URL. Set it only in Script Properties, not in the public site configuration or repository.
   - `COLLECTION_ACTIVE`: `false` until the site and endpoint have been tested.
   - `CAMPAIGN_ID`: a new value for each collection period, such as `2026-12-01-a`.
   - `COLLECTION_START_AT`: an ISO 8601 timestamp with a timezone, such as `2026-12-01T00:00:00+09:00`.
   - `COLLECTION_END_AT`: an ISO 8601 timestamp with a timezone, for example seven days later.
4. Deploy as a **Web app**, executing as the owner and allowing access to anyone. Authorize Drive and external-request access when prompted.
5. Copy the deployed `/exec` URL into `data-contribution-config.js` in the site repository. Keep the endpoint blank until deployment and testing are complete.
6. Test with a disposable participant and inspect the private Drive folder. Only after confirming save, duplicate rejection, and return-to-site behavior, set `COLLECTION_ACTIVE` to `true`.
7. To pause collection immediately, set `COLLECTION_ACTIVE` to `false`. A later campaign should use a new `CAMPAIGN_ID`; the participant's one JSON file is replaced rather than creating a new snapshot.

The selected Drive folder should remain private, and the Google account that owns/runs the web app must have permission to create and update files in it.

The web app exposes only the active campaign window and whether a supplied random participant ID has already submitted in that campaign. It has no Drive read/download operation. Incoming chart IDs are checked against CPI:Next's current public catalog; IDs no longer in the catalog are excluded and reported on the receipt page. Record counts, statuses, duplicate IDs, payload size, consent, and campaign are validated before saving.

## Data and limitations

- The participant ID is a random browser-local UUID, not an account identity. Clearing site storage or changing browsers/devices can create a different ID, so perfect person-level duplicate prevention is impossible without accounts.
- The server accepts one submission per participant ID and campaign. A later campaign can replace that participant's current JSON file. Google Drive may retain file revisions according to its own behavior; the application does not create a snapshot archive.
- The invitation is shown only after the browser has recorded My Page visits on at least two different JST calendar dates in the active campaign's latest seven-day window, at least one platform meets the existing My Target unlock threshold, and AC+INFINITAS together contain at least 50 EASY-or-better chart records.
- The site uses a normal HTML form POST to avoid relying on cross-origin `fetch()` responses. Submission opens a result page in a new tab; users should return to My Page through its confirmation link.
- Eligibility checks and visit-day counts are a quality filter in the browser, not an authentication boundary. The Apps Script endpoint independently validates payload shape and known chart IDs, but an intentionally modified client can bypass the eligibility check.
- The Apps Script URL is public and is not an authentication secret. Validation and the private Drive folder limit impact, but this is intended for modest voluntary collection, not a high-volume public API.
