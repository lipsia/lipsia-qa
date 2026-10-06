# CLAUDE.md

Setup und Bedienung stehen in `README.md`. Hier: Zusammenhänge, die sich nicht direkt aus einer einzelnen Datei ergeben.

## Architektur

- **E2E Hub** (`e2e-hub/`): Express 5, SQLite (`better-sqlite3`), JWT-Session-Cookie. Kein Build-Schritt — `views/*.html` + `public/js/*.js` sind plain JS, `public/js/common.js` stellt `window.Hub` (API-Wrapper, Shell/Navigation, Modals, Toasts) bereit.
- **Seiten-Gating** passiert in `server.js` (`PAGES`), **API-Gating** über `auth.requireAuth` auf `/api` bzw. `auth.requireAdmin` in den Routern.
- **Läufe** (`lib/runner.js`): jeder Lauf ist ein eigener `npx cypress run`-Prozess (detached → Kill über die Prozessgruppe). Ausgabe läuft per SSE; die Event-ID `"<stdoutLen>:<stderrLen>"` erlaubt Reconnects ohne doppelte Ausgabe. Abgeschlossene Läufe bleiben nur im Speicher (`COMPLETED_KEEP`), die Historie steht in `run_log`.
- **Ergebnisse**: `cypress.config.js` druckt nach jedem Spec eine Zeile `[e2e-hub:spec-report] {json}`. `lib/runReport.js` sammelt sie aus dem rohen stdout, filtert sie aus dem Terminal-Stream und baut daraus Result-Label, Failure-Reason und Failure-Log. Marker-String an beiden Stellen synchron halten.
- **Demo-App** (`demo-app/`): fiktives „Sunline CRM“, vom Hub statisch unter `/demo` ausgeliefert, State nur im `localStorage`. Bewusst keine Stage: `lib/runner.js` setzt für Specs unter `cypress/e2e/demo/` `baseUrl` auf die Hub-eigene URL (sonst wartet Cypress auf den Server der gewählten Stage); die Specs setzen sie per Suite-Config (`demoApp`, `expose.demoBaseUrl`) zusätzlich. Specs in `cypress/e2e/demo/` selektieren über `data-testid`; `Offer-Discounts.cy.js` scheitert absichtlich (Bug in `calcOffer`) — nicht „fixen“.
- **Projekt-Daten** (`lib/project.js`): Stages aus `cypress.env.json`, Specs aus `cypress/e2e/`, Step-Suites aus `cypress/step-catalog.js` — bei jedem Request frisch gelesen (Catalog per `require`-Cache-Reset).

## Cypress 16

`Cypress.env()` existiert nicht mehr. `setupNodeEvents` spiegelt `config.env` ohne `secrets` nach `config.expose`; Support-Code liest synchron über `Cypress.expose(key)`. Geheimnisse nur asynchron über `cy.env(['secrets'])` (`secret()` in `support/stage.js`). `return config` am Ende von `setupNodeEvents` ist Pflicht.

## Step-basierte Specs

`support/stepFlow.js` + `step-catalog.js`. Harte Regeln (sonst kann Cypress Studio Aufnahmen nicht speichern bzw. die Vorbedingungs-Kette greift nicht):

- jeder Step ist ein literales `it('titel', () => { … })` — keine Wrapper, keine Schleifen;
- `createStepFlow(...)` im Modul-Scope **vor** `context()`;
- Katalog-`title` = `it()`-Titel exakt;
- State aus früheren Steps im Body nur innerhalb von `cy.then(() => …)` lesen.

Cutoff-Env-Key ist `<suite>LastStep`; der E2E Hub validiert den Key gegen den Katalog.

## Live View

Nur im Container (Xvfb/x11vnc vorhanden → `displayPool.POOL_AVAILABLE`). Pro Headed-Lauf: eigenes Xvfb-Display aus dem Pool, fluxbox (maximiert alles, `docker/fluxbox-*`), x11vnc `-viewonly`, Token in `/tmp/novnc-tokens` (atomar ersetzt, websockify liest bei jeder Verbindung). Die Framebuffer-Größe `DISPLAY_POOL_GEOMETRY` bestimmt Browserfenster (`E2E_HUB_SCREEN_GEOMETRY` → `before:browser:launch`) und Popup-Format (`openLiveView` in `public/js/runner.js`) — nur gemeinsam ändern. Live View und parallele Läufe schließen sich aus (UI und Server).

## Konventionen

- Code-Kommentare englisch und knapp: beschreiben, *was* und *warum*, keine Änderungshistorie.
- UI-Texte englisch, Doku deutsch.
- Farben/Abstände nur über die Tokens in `public/css/app.css` (Lipsia Digital: Indigo `#312782`, Orange-Verlauf `#ff7133 → #ff3834`, Rubik).
- Motion: Easing-Tokens (`--ease-out`, `--ease-spring`, …) und Helfer in `common.js` (`Hub.reveal`, `Hub.stagger`, `Hub.countUp`, `Hub.replay`, `Hub.segmented`) verwenden. Listen, die per Polling neu gerendert werden, nur für neue Einträge animieren. Alles muss unter `prefers-reduced-motion` ohne Animation funktionieren (globaler Block am Ende von `app.css`).
- DB-Schema in `lib/db.js` (`CREATE TABLE IF NOT EXISTS`). Spätere Schemaänderungen brauchen eine Migration für bestehende Datenbanken.
