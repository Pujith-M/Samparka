# Google Sheets setup and manual verification

Google Sheets is optional and does not affect local contact storage. Use a dedicated Google test account and a disposable spreadsheet. The connector uses an insert-only initial import: remote-only IDs are added locally, existing local contacts are preserved, and local content wins for matching IDs. Local mutations are durably queued and can be backed up to the selected worksheet. Do not test against personal contact data.

## Google Cloud setup

1. Create or choose a Google Cloud project and enable **Google Sheets API** and **Google Picker API**. This spike does not call the Drive REST API, so it does not need to be enabled for its current flow.
2. Configure the Google Auth Platform branding and OAuth consent screen. Add a test user while the app is in Testing status.
3. Create an OAuth Client ID with application type **Web application**. Add both local development origin (`http://localhost:5173`) and the exact production origin, for example `https://<account>.github.io`. An origin has no path; register a custom domain origin separately if one is later used.
4. Create an API key under **APIs & Services → Credentials → Create credentials → API key**. Restrict **Application restrictions** to Websites and allow `http://localhost:5173/*`, your production app origin (for example `https://<account>.github.io/*`), and `https://docs.google.com/*` (Picker runs in a Google-hosted iframe). Under **API restrictions**, select **Google Picker API**. Add Google Drive API only if a future feature calls Drive REST endpoints directly, as described by the [Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample). The OAuth client ID, API key, and numeric Cloud project number are public browser configuration, not secrets.
5. Add these values to an untracked `.env.local` for local use or the deployment environment. For GitHub Actions Pages deployment, add them as environment secrets to the `github-pages` environment. The build job maps these secrets to `VITE_*` variables. Values with the `VITE_` prefix are embedded in the client bundle and visible to site visitors, so these are configuration values rather than private credentials; restrict the Google API key by referrer and API in Google Cloud.

```sh
VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-restricted-api-key
VITE_GOOGLE_APP_ID=your-numeric-cloud-project-number
```

Find the numeric **Project number** in **IAM & Admin → Settings** (or the project dashboard). Do not use the project name or project ID string for `VITE_GOOGLE_APP_ID`; Picker's app ID is the Cloud project number.

Never put a client secret, service-account credential, private key, refresh token, or user access token in these values or the frontend bundle.

## Manual account check

1. Start the app with the configuration above and open **Google Sheets**. Confirm no Google call happens before you choose an action.
2. Choose an existing disposable Samparka sheet. Confirm Google shows the app identity and file access request. Reject once and verify local contacts remain usable and authorization can be retried.
3. Import a sheet containing one remote-only contact and one ID already present locally with different values. Confirm the remote-only row is imported, the local record is unchanged, and its local version remains queued for backup.
4. Create and edit a local test contact. Choose **Back up pending changes** and verify the matching stable-ID row is created or updated without duplicating it. Add an unrelated column to the sheet and verify the connector preserves it.
5. Simulate an uncertain append by allowing the write to reach Google but dropping the response in a test harness. Retry and confirm the consumer reads by stable ID and updates the existing row rather than appending a duplicate.
6. Select a worksheet with the complete ten-column schema. Verify a sheet missing `id` or `archivedAt` is rejected without changes. Create a test contact, delete it, and verify its matching sheet row is archived rather than physically deleted; then restore it and verify the archive marker is cleared.
7. Go offline, edit a contact, reload the app, then reconnect and return to the app while the token remains valid. Verify the event remains pending offline and retries after reconnect/resume. Confirm a second open tab does not run the consumer concurrently.
8. Revoke the app in Google Account third-party connections or wait for token expiry. Verify local data and pending events remain, and the UI asks for reconnection. Disconnect and confirm the selected-sheet setting and token are cleared while the outbox remains.
9. Inspect browser storage and logs: the access token must not be persisted or logged, and contact contents must not appear in diagnostics.

The sample-row action is retained for adapter feasibility checks and should only be used with the disposable test spreadsheet.

Automated adapter tests mock Google responses. They cannot replace this real-account smoke check, and no live Google Cloud credentials are committed to the repository.
