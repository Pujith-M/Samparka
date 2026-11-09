# ADR 0001: Browser authorization for optional Sheets backup

- Status: Browser authorization and durable outbox consumer implemented in part; real-account smoke checks and remaining sync recovery work are pending.
- Date: 2026-10-16
- Related: Issues [#6](https://github.com/Pujith-M/Samparka/issues/6), [#13](https://github.com/Pujith-M/Samparka/issues/13), [#14](https://github.com/Pujith-M/Samparka/issues/14), [#15](https://github.com/Pujith-M/Samparka/issues/15), [#7](https://github.com/Pujith-M/Samparka/issues/7).

## Decision

Use Google Identity Services (GIS) token client in the browser, Google Picker to let the user choose one spreadsheet, and Sheets API v4 REST calls with the resulting short-lived user access token. Start with `https://www.googleapis.com/auth/drive.file` only. Keep the token in memory and request it again after expiry or revocation. No Samparka backend, OAuth client secret, service account, refresh token, or token persistence is part of this design.

The connector reads metadata and worksheet previews, lets the user create a new spreadsheet or pick an existing one, and retains an explicit sample-row action for a dedicated test spreadsheet. It imports remote-only contact IDs without overwriting local records and consumes a durable IndexedDB outbox for one-way backup. `spreadsheets.create` accepts the selected `drive.file` scope. The schema is defined in issue #14; the remaining consumer reliability work is tracked in #15.

## Evidence and feasibility

Google's [Sheets API scope table](https://developers.google.com/workspace/sheets/api/scopes) lists `drive.file` as recommended, non-sensitive, and limited to the specific Drive files the app uses. The [Google Picker web guide](https://developers.google.com/workspace/drive/picker/guides/web-picker) uses the same `drive.file` token for Picker. These documented interfaces support the proposed least-privilege path for the selected file; do not request `spreadsheets` or broad Drive scopes unless a manual operation proves `drive.file` insufficient.

The [GIS authorization guide](https://developers.google.com/identity/oauth2/web/guides/overview) supports browser access tokens. Google explains in its [authorization flow comparison](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model) that the browser implicit/token flow does not issue refresh tokens and requires a user action to get a replacement. This matches Samparka's local-first model but means pending future sync must wait for the user to reconnect. A background service cannot sync while the user is absent without a backend authorization-code flow and secure refresh-token storage, which is out of scope.

The spike uses broad file permission within the user's _app-selected_ files, not per-worksheet restriction: Sheets scopes apply to the spreadsheet file. Picker selection is therefore an important consent boundary, but does not make the selected spreadsheet private from other collaborators.

## Security and privacy

- OAuth client ID, API key, and Cloud project number are public client configuration. Restrict the API key by HTTP referrer and enabled APIs. Never commit a client secret, service-account private key, refresh token, access token, or real contact data.
- The access token is held only in component memory, is not written to IndexedDB/local storage, and is not logged. Closing/reloading the app drops it. Its expiry is tracked in memory; `401` clears it and asks the user to reconnect.
- Disconnect clears the in-memory token and selected spreadsheet setting. It does not delete or change the user's Google file, local contacts, or pending operations.
- Google account consent can be revoked by the user in their Google Account. Subsequent calls fail and require reconnect/consent. This spike does not issue a separate token revocation request.
- Google API errors are represented without logging response bodies, tokens, or contact contents. The sample-write action is explicit and marked for a dedicated test sheet.
- GitHub Pages is compatible with browser OAuth when the deployed HTTPS origin is registered in the OAuth web client. A custom domain or changed Pages origin requires updating the authorized JavaScript origin.

## Configuration and manual verification

See [Google Sheets setup](../google-sheets-setup.md) for Cloud Console setup, environment variables, GitHub Pages origin, and manual test steps. Mocked tests cover metadata/preview, write payload, consent guard, 401 expiry, and API errors. Automated browser mocks cannot prove that a real Google Cloud project has enabled APIs, accepted the OAuth origin, granted the selected scope, and authorized the chosen spreadsheet. Complete the documented real-account check before relying on live integration.

## Consequences

- Local contact storage remains the source of truth; Sheets is an optional one-way backup destination. Browser storage eviction can remove contacts and events, and the app cannot guarantee work while closed.
- `drive.file` appears sufficient according to current official scope documentation for Picker-selected sheets and Sheets read/write operations. The real-account test remains a release gate for that conclusion.
- Expiry and API failures interrupt remote work but must never remove local data. Production UI should retain queued operations and expose reconnect/retry states.
- Further implementation should share the auth and Sheets boundary in `src/google/googleSheets.ts`; issue #14 should consolidate the sheet mapping and safe row operations rather than add another adapter.
