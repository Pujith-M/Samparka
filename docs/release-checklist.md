# Samparka release checklist

Use this checklist before enabling or announcing a public beta. The Google integration remains optional; local contact CRUD must work without Google configuration.

## Before a release

- [ ] Run `npm test`, `npm run test:e2e`, `npm run lint`, and `npm run build`.
- [ ] Confirm GitHub Actions validates the build artifact and only deploys from `main`.
- [ ] Verify the production manifest, icon paths, service-worker scope, and `/Samparka/` asset base in the artifact.
- [ ] Open the deployed app directly and refresh it; confirm the app shell loads offline after its first successful load.
- [ ] Check contact CRUD, search, filtering, and sorting at mobile and desktop widths, including keyboard navigation and visible focus.
- [ ] Confirm browser storage contains contacts and outbox metadata but no Google access token.
- [ ] Confirm the deployed [privacy policy](../public/privacy.html) is reachable and describes the current behavior.
- [ ] Review `.env` and the generated bundle for private keys, client secrets, access tokens, or real contact data.

## Optional Google Sheets beta

- [ ] Configure authorized JavaScript origins for the deployed GitHub Pages origin and any custom domain.
- [ ] Review OAuth branding, the `drive.file` scope, test/publishing status, and any Google verification requirements for the intended audience.
- [ ] Complete the dedicated test-account and disposable-sheet procedure in [Google Sheets setup](google-sheets-setup.md).
- [ ] Verify import preserves local records, remote-only IDs are imported once, and pending local archives are not resurrected.
- [ ] Verify uncertain writes reconcile by stable ID, archive/restore does not physically delete rows, and unrelated worksheet columns remain intact.
- [ ] Confirm expired/revoked authorization preserves the outbox and reconnect resumes it.
- [ ] Record known Google API, browser, and device limitations before inviting beta users.

## Current limitations

- The Google consumer runs in the browser and cannot guarantee background work while the app is closed.
- A short-lived access token is kept in memory; users may need to reconnect after reload or expiry.
- Browser storage can be cleared or evicted. File-based export/restore is not implemented.
- Multi-device editing and conflict resolution are not implemented.
- Automated browser end-to-end coverage and a real Google account smoke check remain release gates.
