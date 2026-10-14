# Samparka

**Samparka is planned as a private, offline-first place to keep contact details and the small things worth remembering about people.** The long-term direction is an installable web app that stores its data on the user's device and can optionally back it up to a spreadsheet in the user's own Google account.

This repository is the starting point for that product. At present, it contains a responsive React and TypeScript placeholder screen, a Vite build, PWA manifest and service worker setup, and basic test and code-quality tooling. Contact management, browser storage, Google sign-in, and backup are not implemented yet.

## Project status

| Area                                             | Status                      |
| ------------------------------------------------ | --------------------------- |
| React, TypeScript, and Vite foundation           | In place                    |
| Responsive Samparka placeholder screen           | In place                    |
| Tailwind CSS integration                         | In place                    |
| Web app manifest, icons, and service worker      | Configured                  |
| App-shell precache and navigation fallback       | Configured                  |
| Contact screens and CRUD                         | Planned                     |
| IndexedDB persistence                            | Planned                     |
| Google Sheets authorization, backup, and restore | Future work; not configured |
| Encryption, conflict handling, and AI features   | Longer-term ideas           |

## Product principles

- **Local by default:** Contact data should live in the user's browser. No account or cloud service should be required for everyday use.
- **Works without a connection:** The app shell should load offline after it has been cached. Contact data should remain available locally once local storage is implemented.
- **Optional backup:** A future Google Sheets integration should only run after the user explicitly connects it. The spreadsheet would belong to the user's Google account.
- **Portable data:** Export and restore options should let people keep control of their information.
- **Small client-only foundation:** The initial product is intended to run as a static web app without a Samparka-operated backend.

## Architecture direction

The diagram shows the intended product architecture. The solid app shell and service-worker setup exist in this repository; the contact store and optional Google backup are planned components.

```mermaid
flowchart LR
    Person[User] --> Browser[Browser or installed PWA]
    Browser --> UI[React interface]
    UI --> Local[(Device contact store<br/>IndexedDB — planned)]
    SW[Service worker] --> Cache[(Cached app shell)]
    Browser <--> SW
    UI -. optional, after authorization .-> Auth[Google authorization — planned]
    Auth -. access token .-> Sheets[Google Sheets API — planned]
    Sheets <--> Book[(User-owned spreadsheet)]
```

The service worker is configured to precache the production app shell and use the app page as a navigation fallback. Runtime API caching is disabled. In particular, the current service worker does not cache contact data or API responses.

## Intended contact and backup flow

This flow describes the planned behavior once local contacts and optional backup have been built. It is not a description of functionality available in the current placeholder.

```mermaid
flowchart TD
    Start[Open Samparka] --> Load[Load app shell from network or service-worker cache]
    Load --> Read[Read contacts from device storage]
    Read --> Edit[Add or view a contact]
    Edit --> Save[Save locally first]
    Save --> Choice{Has the user connected backup?}
    Choice -- No --> Done[Continue offline; no cloud request]
    Choice -- Yes --> Online{Network available?}
    Online -- No --> Queue[Keep local change for later backup]
    Online -- Yes --> Sync[Send authorized change to user's spreadsheet]
    Queue --> Online
    Sync --> Done
```

The backup flow still needs design and implementation. It will need explicit authorization, a way to select or create the backup spreadsheet, and clear handling for network errors, token expiry, duplicate records, and edits made on more than one device.

## Contact data model under consideration

A contact could use fields like these. This is a planning example, not an active database schema:

```ts
interface Contact {
  id: string
  name: string
  phone?: string
  email?: string
  notes?: string
  createdAt: number
  updatedAt: number
}
```

IndexedDB is the preferred direction for structured local data. A small wrapper can be selected when contact persistence is implemented. The current app does not save contacts.

## Run the project

### Prerequisites

- Node.js 20.19+ or 22.12+
- npm 10+

### Install and start the development server

```sh
npm install
npm run dev
```

Open the local address printed by Vite.

### Build and preview

```sh
npm run build
npm run preview
```

The production output is written to `dist/`.

### Checks and formatting

```sh
npm run test
npm run lint
npm run format:check
```

Run `npm run format` to apply Prettier formatting. The smoke test uses Vitest and React Testing Library.

## PWA and offline behavior

The production build includes a web app manifest, PNG and SVG placeholder icons, and a Workbox service worker. The service worker precaches the generated app shell and falls back to `index.html` for navigation requests. It has no runtime API caching rules.

A deployed PWA needs a secure context, normally HTTPS. `localhost` is treated as secure for local development. The current offline support covers the app shell; it does not imply offline contact management because contact storage and contact screens have not been implemented. Placeholder typography loads from Google Fonts when a network connection is available and falls back to local system fonts otherwise.

## Deployment direction

The project is a static Vite app and can be hosted on a static HTTPS host such as GitHub Pages. A deployment workflow and GitHub Pages base-path configuration have not been added yet. Before publishing from a repository subpath, configure Vite's `base` value to match that path and add a deployment workflow. Verify the published manifest, icon URLs, service-worker scope, installation prompt, and app-shell loading while offline.

## Privacy and security direction

- The current placeholder has no contact data, sign-in, or synchronization.
- When local contact storage is added, clearing browser storage or changing devices can remove the only copy. An export or backup path should be available before relying on the app for important information.
- Any future Google integration should request only the access it needs and explain what information will be written to the selected spreadsheet. OAuth client identifiers are not private secrets; private keys and service-account credentials must never be shipped in frontend code.
- Data in a Google spreadsheet would follow that spreadsheet's sharing and account settings. A client-only app does not make a shared spreadsheet private.
- Encryption and multi-device conflict resolution are not implemented. Their requirements should be decided before backup is treated as a reliable sync system.

## Roadmap

1. **Contact basics:** Build contact list and detail views, create/edit/delete interactions, and accessible responsive forms.
2. **Local persistence:** Add IndexedDB storage, migrations, and a clear export/restore format.
3. **Backup design:** Decide how users select a spreadsheet, authorize access, and restore data; document failure and conflict behavior.
4. **Optional Google Sheets backup:** Implement the agreed backup flow without placing private credentials in the client.
5. **Reliability and privacy:** Add sync status, retry behavior, conflict choices, and evaluate whether encrypted backups are needed.
6. **Explore later ideas:** Consider tags, duplicate suggestions, and other features only after the core data flows are dependable.

## Technology

- React and TypeScript for the interface
- Vite for local development and production builds
- Tailwind CSS for styling utilities and design tokens
- `vite-plugin-pwa` and Workbox for the manifest and app-shell service worker
- Vitest, jsdom, and React Testing Library for component checks
- ESLint and Prettier for code quality and formatting

The dependency versions are recorded in `package-lock.json`; use `npm install` to install the locked project dependencies. TypeScript is on 6.0.3, the newest release supported by the current `typescript-eslint` release. TypeScript 7 is newer, but that linter currently rejects it.
