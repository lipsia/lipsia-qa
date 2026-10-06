# Lipsia QA

End-to-End-Testframework auf Basis von **Cypress 16** mit einem webbasierten **E2E Hub**, über den Specs gegen verschiedene Umgebungen gestartet, live verfolgt und ausgewertet werden.

- **Test Runner** — Spec und Umgebung wählen, Optionen setzen (Browser, Geschwindigkeit, parallele Läufe, Live View, Video), Ausgabe live im Browser verfolgen.
- **Live View** — Headed-Läufe laufen im Container in einem eigenen virtuellen Display und lassen sich read-only per noVNC beobachten.
- **Test Steps** — Step-basierte Specs lassen sich bis zu einem bestimmten Step ausführen; Vorbedingungen werden automatisch nachgespielt.
- **Dashboard** (Admins) — Laufhistorie, Erfolgsquote, Läufe pro Tag und Nutzer, ausführliche Fehler-Logs.
- **Coverage** — Übersicht, welche Systeme/Features durch Tests abgedeckt sind, mit Änderungshistorie.
- **Benutzerverwaltung** — Rollen `admin`/`user`, optionale Tags (Product Owner / Developer) für die Statistik.

## Schnellstart

Voraussetzungen: Node.js ≥ 24 (siehe `.nvmrc`), für den Container Docker mit Compose.

```bash
make setup            # npm ci, legt cypress.env.json und .env aus den Vorlagen an
# cypress.env.json: baseUrls der Umgebungen eintragen
make e2e-hub          # http://localhost:9877
```

Beim ersten Aufruf fragt die Login-Seite nach einem Admin-Konto — der erste Account wird Administrator.

### Im Container

```bash
make setup            # falls noch nicht geschehen (erzeugt u. a. SESSION_SECRET in .env)
make up               # baut das Image und startet den Container
make logs
```

| Port | Dienst |
|---|---|
| 9877 | E2E Hub |
| 6080 | noVNC-Gateway für die Live View |

Standardmäßig werden beide Ports nur auf `127.0.0.1` veröffentlicht (`BIND_ADDRESS` in `.env`). Liegt der E2E Hub hinter einem Reverse Proxy, `TRUST_PROXY=1` setzen und die öffentliche Adresse des Live-View-Gateways in `VNC_PUBLIC_BASE_URL` eintragen.

Gemountet werden `cypress.env.json` (read-only), das Verzeichnis `cypress/` (neue Specs erscheinen ohne Rebuild), `test-reports/` und ein Volume für die SQLite-Datenbank.

## Konfiguration: `cypress.env.json`

Vorlage: `cypress.env.example.json`. Die Datei ist in `.gitignore` und wird nicht eingecheckt.

```json
{
  "systemUnderTest": "dev",
  "stages": {
    "dev":        { "description": "Development", "baseUrl": "https://dev.example.com" },
    "staging":    { "description": "Staging",     "baseUrl": "https://staging.example.com" },
    "production": { "description": "Production",  "baseUrl": "https://www.example.com", "protected": true }
  },
  "secrets": {}
}
```

- `systemUnderTest` — Standard-Umgebung für CLI-Läufe; der E2E Hub übergibt die gewählte Umgebung pro Lauf per `--env systemUnderTest=<name>`.
- `stages.<name>.baseUrl` — wird zur Cypress-`baseUrl`, `cy.visit('/')` landet also auf der gewählten Umgebung. Weitere Felder pro Stage (API-URLs etc.) sind frei wählbar und über `cypress/support/stage.js` lesbar.
- `protected: true` — der E2E Hub verlangt vor einem Lauf gegen diese Umgebung eine Bestätigung.
- `secrets` — wird **nicht** in den Browser gespiegelt; in Specs per `secret('key')` aus `cypress/support/stage.js` lesen.

## Tests schreiben

Specs liegen unter `cypress/e2e/<bereich>/…/*.cy.js`. Der erste Ordner unter `e2e/` ist die Kategorie, nach der der E2E Hub gruppiert; pro Kategorie gibt es zusätzlich den Eintrag „All specs in …“. Ordner und Dateien mit `_` oder `.` am Anfang werden ignoriert.

```js
import { stage, secret } from '../../support/stage'

describe('Startseite', () => {
  it('lädt', () => {
    cy.visit('/')
    cy.terminalLog(`Umgebung: ${stage.description}`)
  })
})
```

`cy.terminalLog(text)` schreibt zusätzlich ins Terminal (sichtbar im E2E Hub und in CI-Logs).

### Step-basierte Specs

Für lange, fachliche Abläufe kann eine Spec in Steps zerlegt werden. Die Steps werden in `cypress/step-catalog.js` beschrieben; der E2E Hub bietet dann unter „Test steps“ an, nur bis zu einem bestimmten Step zu laufen.

```js
// cypress/step-catalog.js
module.exports = {
  checkout: {
    spec: 'cypress/e2e/shop/checkout.cy.js',
    label: 'Checkout',
    steps: [
      { key: 'login', title: 'Log in', label: 'Log in', critical: true },
      { key: 'cart', title: 'Add product to cart', label: 'Add product to cart', group: 'cart' },
      { key: 'pay', title: 'Pay order', label: 'Pay order', requires: ['cart'] },
    ],
  },
}
```

```js
// cypress/e2e/shop/checkout.cy.js
import { createStepFlow } from '../../support/stepFlow'

const flow = createStepFlow({ suite: 'checkout' })   // Modul-Scope, vor context()

context('Checkout', () => {
  beforeEach(function () { flow.beforeEach(this) })
  afterEach(function () { flow.afterEach(this) })

  it('Log in', () => { /* … */ })
  it('Add product to cart', () => { /* … */ })
  it('Pay order', () => { /* … */ })
})
```

Details zu Feldern und Regeln stehen in den Kopfkommentaren von `cypress/step-catalog.js` und `cypress/support/stepFlow.js`. Per CLI: `--env checkoutLastStep=cart` (bis Step `cart`), `--env checkoutLastStep=none` (Trockenlauf).

### Lokal ausführen

```bash
npm run cy:open                                              # Cypress-App
npx cypress run --spec cypress/e2e/shop/checkout.cy.js --env systemUnderTest=staging
```

Reports landen in `test-reports/` (Mochawesome-HTML unter `html/`, JUnit-XML unter `junit/`).

## Benutzerverwaltung

Im E2E Hub unter **Users** (nur Admins), alternativ per CLI:

```bash
make user-add NAME=anna PASS='geheim123' ROLE=admin
make user-list
make user-passwd NAME=anna PASS='neuesPasswort'
make user-delete NAME=anna
```

Mit dem Suffix `-docker` (z. B. `make user-list-docker`) laufen die Befehle im Container.

## Umgebungsvariablen des E2E Hubs

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `9877` | HTTP-Port |
| `SESSION_SECRET` | zufällig | Signiert die Session-Cookies; ohne festen Wert enden Sessions beim Neustart |
| `DB_FILE` | `data/e2e-hub.sqlite` | SQLite-Datenbank (Nutzer, Laufhistorie, Coverage) |
| `TRUST_PROXY` | `0` | Anzahl vorgeschalteter Reverse Proxies |
| `VNC_PUBLIC_BASE_URL` | – | Öffentliche URL des noVNC-Gateways |
| `VNC_PUBLIC_PORT` | `6080` | Port des Gateways, wenn keine Base-URL gesetzt ist |
| `MAX_CONCURRENT_RUNS_PER_USER` | `10` | Gleichzeitige Läufe pro Nutzer |
| `PARALLEL_START_DELAY_MS` | `10000` | Versatz zwischen parallelen Läufen |
| `DISPLAY_POOL_SIZE` | `20` | Maximale Anzahl gleichzeitiger Live Views |
| `DISPLAY_POOL_GEOMETRY` | `1920x1080x24` | Auflösung der Live-View-Displays |

## Projektstruktur

```
e2e-hub/
  server.js          Express-App, Seiten- und API-Routing
  lib/               auth, db, runner (Cypress-Prozesse), runReport, displayPool, usage, coverage, project
  routes/            REST-Endpunkte
  views/             HTML-Seiten
  public/            CSS, JS, Assets
cypress/
  e2e/               Specs
  step-catalog.js    Step-Definitionen für step-basierte Specs
  support/           e2e.js, commands.js, stage.js, stepFlow.js
docker/              Dockerfile, supervisord, fluxbox, noVNC
scripts/             manage-user.js
```
