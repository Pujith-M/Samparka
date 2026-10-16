# Google Sheets feasibility spike setup

This spike is optional and does not affect local contact storage. Use a dedicated Google test account and a disposable spreadsheet. The demo's **Append sample row** action writes a synthetic test contact to the selected first worksheet.

## Google Cloud setup

1. Create or choose a Google Cloud project and enable **Google Sheets API**, **Google Picker API**, and **Google Drive API** as required by Google's Picker setup guide.
2. Configure the Google Auth Platform branding and OAuth consent screen. Add a test user while the app is in Testing status.
3. Create an OAuth Client ID with application type **Web application**. Add both local development origin (`http://localhost:5173`) and the exact production origin, for example `https://<account>.github.io`. An origin has no path; register a custom domain origin separately if one is later used.
4. Create an API key under **APIs & Services → Credentials → Create credentials → API key**. Restrict **Application restrictions** to Websites and allow `http://localhost:5173/*`, your production app origin (for example `https://<account>.github.io/*`), and `https://docs.google.com/*` (Picker runs in a Google-hosted iframe). Under **API restrictions**, select **Google Picker API** and **Google Drive API**, as described by the [Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample). The OAuth client ID, API key, and numeric Cloud project number are public browser configuration, not secrets.
5. Add these values to an untracked `.env.local` for local use or the deployment environment. For GitHub Actions Pages deployment, expose them as repository variables (not secrets; they are public after bundling) and pass them as `VITE_*` build environment variables.

```sh
VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-restricted-api-key
VITE_GOOGLE_APP_ID=your-numeric-cloud-project-number
```

Find the numeric **Project number** in **IAM & Admin → Settings** (or the project dashboard). Do not use the project name or project ID string for `VITE_GOOGLE_APP_ID`; Picker's app ID is the Cloud project number.

Never put a client secret, service-account credential, private key, refresh token, or user access token in these values or the frontend bundle.

## Manual account check

1. Start the app with the configuration above and open **Google Sheets**.
2. Choose **Connect and choose spreadsheet**. Confirm Google shows the app identity and a file-specific access request; reject once and confirm the denial is recoverable by retrying.
3. Try **Create and select new spreadsheet** once and confirm the created file is selected and its first worksheet preview opens. Disconnect, then choose an existing disposable spreadsheet. Open Picker and cancel once; confirm local contacts remain available.
4. Confirm the selected title, worksheet list, and first six rows load. Try a spreadsheet the test user cannot access and confirm the API error is visible without losing local data.
5. Append the synthetic row only to the disposable test file, then verify its stable ID and JSON array cells. Test an explicit update against a known range with a test value using the Sheets API Explorer or a test harness. The spike adapter exposes narrow `updateRow` for this; production UI intentionally does not offer arbitrary range editing.
6. Confirm metadata writes are refused without the explicit-consent flag. Only after user consent should a test harness call `addMetadataColumns(..., true)`.
7. To exercise expiry, revoke the app in Google Account third-party connections or wait for token expiry, then retry. A 401 must show reconnect guidance; GIS requires a fresh user gesture and never silently refreshes this browser token.
8. Inspect browser storage and logs: the access token must not be persisted or logged, and no real contact data should be used for testing.

Automated adapter tests mock Google responses. They cannot replace this real-account smoke check, and no live Google Cloud credentials are committed to the repository.
