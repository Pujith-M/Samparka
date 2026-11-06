# Samparka

**Samparka is a local-first contact app in development.** Its direction is an installable PWA for keeping contact details and useful context on the user's device. Optional backup to a spreadsheet in the user's own Google account is a future direction; it is not implemented.

This checkout contains the React, TypeScript, and Vite foundation, PWA setup, typed contact model with a local IndexedDB repository, and mobile-first contact app shell. The contact UI supports local create, read, update, delete, search, sorting, and tag filtering. Phone numbers in a contact detail view use the device's `tel:` handler, so users can tap to call. Google sign-in and production backup are not implemented.

## Project status

| Area | Status |
| --- | --- |
| React, TypeScript, Vite, Tailwind, and PWA foundation | In place |
| Typed contact model and IndexedDB repository | In place |
| Mobile-first app shell and navigation | In place |
| Contact list, detail, and manual CRUD | In place |
| Local search, sorting, and tag filtering | In place |
| Tap-to-call from a saved contact | In place |
| Google Sheets feasibility spike | Opt-in demo; requires Google Cloud configuration and a real-account smoke check |
| Production Google sign-in, backup/restore, and synchronization | Future work; not implemented |

## Product principles

- **Local by default:** Contact data should live in the user's browser. No account or cloud service should be required for everyday use.
- **Works without a connection:** The app shell should load offline after it has been cached. The contact repository reads and writes browser-local IndexedDB without a network connection.
- **Optional backup:** A future Google Sheets integration should only run after the user explicitly connects it. The spreadsheet would belong to the user's Google account.
- **Small client-only foundation:** The initial product is intended to run as a static web app without a Samparka-operated backend.

## Run locally

Requirements: Node.js 24.15+ and npm.

```sh
npm ci
npm run dev
```

Build and verify locally:

```sh
npm run lint
npm test
npm run build
npm run preview
```

The production output is written to `dist/`.

## GitHub Pages deployment

Samparka is deployed to **https://pujith-m.github.io/Samparka/**.

The workflow at `.github/workflows/deploy-pages.yml` runs automatically on every push to `main` and can also be started manually from the Actions tab. It installs the locked dependencies, runs lint and tests, builds the production PWA, and deploys the `dist/` directory to GitHub Pages. A failed check prevents deployment.

The Vite base path is configured as `/Samparka/` so JavaScript, CSS, icons, the web app manifest, and the service worker resolve correctly under the repository URL (rather than the domain root).

### One-time repository setting

In GitHub, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source. The workflow uses the Pages deployment environment and the minimum required `pages: write` and `id-token: write` permissions.

After that, merge changes into `main`; GitHub Actions will publish them. Check the latest run under the repository's **Actions** tab.

## PWA and offline behavior

The production build includes a web app manifest, app icons, and a Workbox service worker. The service worker precaches the generated app shell and falls back to the app page for navigation requests. The contact repository stores data in IndexedDB on the current device, so contact CRUD does not require a network connection. Install the site from the browser's **Add to Home screen** / **Install app** option after visiting the HTTPS GitHub Pages URL.

Offline support is device-local: contacts are not automatically copied to another device. Clearing browser storage can remove the local copy. Export/backup and production Google Sheets synchronization remain future work; do not rely on the Google Sheets demo as a backup system.

## Privacy and security

- Contacts are stored locally in the browser. There is no Samparka-operated backend.
- Clearing browser storage or changing devices can remove the only local copy.
- Any future Google integration must require explicit authorization and explain what data is written to the selected spreadsheet.
- Encryption and multi-device conflict resolution are not implemented.

## Technology

- React and TypeScript
- Vite and Tailwind CSS
- IndexedDB via `idb`
- `vite-plugin-pwa` and Workbox
- Vitest, jsdom, and React Testing Library
- ESLint and Prettier
