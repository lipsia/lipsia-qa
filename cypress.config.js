const { defineConfig } = require('cypress')

// Marker line the E2E Hub parses from stdout to build run results (see
// e2e-hub/lib/runReport.js). Must stay in sync with SPEC_REPORT_MARKER there.
const SPEC_REPORT_MARKER = '[e2e-hub:spec-report]'

// Keys of cypress.env.json that are NOT mirrored into `expose` and therefore never reach the
// browser bundle synchronously. Read them in specs via `cy.env(['secrets'])`.
const PRIVATE_ENV_KEYS = ['secrets']

function resolveStage(env) {
  const stages = env.stages || {}
  const name = env.systemUnderTest
  const stage = stages[name]
  if (!stage) {
    throw new Error(
      `Unknown systemUnderTest "${name}". It must match a key of "stages" in cypress.env.json ` +
      `(available: ${Object.keys(stages).join(', ') || 'none'}).`,
    )
  }
  return stage
}

function cleanDisplayError(displayError) {
  return String(displayError || '')
    .split('\n')
    .filter((line) => !/^\s*at\s.*node_modules[\\/]cypress/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildSpecReport(spec, results) {
  const stats = (results && results.stats) || {}
  const tests = (results && results.tests) || []
  const failed = tests.filter((t) => t.state === 'failed')
  return {
    spec: (spec && (spec.relative || spec.name)) || null,
    tests: typeof stats.tests === 'number' ? stats.tests : tests.length,
    passes: stats.passes || 0,
    failures: typeof stats.failures === 'number' ? stats.failures : failed.length,
    pending: stats.pending || 0,
    skipped: stats.skipped || 0,
    durationMs: stats.duration || 0,
    failed: failed.slice(0, 10).map((t) => ({
      title: (t.title || []).join(' > '),
      error: cleanDisplayError(t.displayError).slice(0, 4000),
    })),
  }
}

module.exports = defineConfig({
  viewportWidth: 1920,
  viewportHeight: 1080,
  video: false,
  videoCompression: false,
  screenshotsFolder: 'test-reports/screenshots',
  videosFolder: 'test-reports/videos',
  e2e: {
    specPattern: 'cypress/e2e/**/*.cy.{js,ts}',
    supportFile: 'cypress/support/e2e.js',
    scrollBehavior: 'center',
    defaultCommandTimeout: 10000,
    experimentalInteractiveRunEvents: true,
    setupNodeEvents(on, config) {
      const stage = resolveStage(config.env)
      if (!config.baseUrl && stage.baseUrl) config.baseUrl = stage.baseUrl

      on('task', {
        log(message) {
          console.log(message)
          return null
        },
      })

      // Live View runs get their own Xvfb display; size the browser window to fill it.
      on('before:browser:launch', (browser = {}, launchOptions) => {
        const geometry = /^(\d+)x(\d+)$/.exec(process.env.E2E_HUB_SCREEN_GEOMETRY || '')
        if (!geometry) return launchOptions
        const width = Number(geometry[1])
        const height = Number(geometry[2])
        if (browser.name === 'electron') {
          launchOptions.preferences = { ...launchOptions.preferences, width, height, x: 0, y: 0 }
        } else if (browser.family === 'chromium' && Array.isArray(launchOptions.args)) {
          launchOptions.args = launchOptions.args.filter((arg) => !/^--window-(size|position)=/.test(arg))
          launchOptions.args.push(`--window-size=${width},${height}`, '--window-position=0,0')
        }
        return launchOptions
      })

      on('after:spec', (spec, results) => {
        process.stdout.write(`\n  ${SPEC_REPORT_MARKER} ${JSON.stringify(buildSpecReport(spec, results))}\n`)
      })

      // Cypress 16 reads env values asynchronously only (cy.env). Mirror the non-secret part
      // into `expose` so specs and support code can read configuration synchronously.
      const exposed = { ...config.env }
      PRIVATE_ENV_KEYS.forEach((key) => delete exposed[key])
      config.expose = { ...(config.expose || {}), ...exposed }

      // The demo app is served by the E2E Hub itself (/demo), so the demo specs ignore the stage.
      // The hub passes its PORT on to every run.
      config.expose.demoBaseUrl = process.env.DEMO_BASE_URL || `http://localhost:${process.env.PORT || 9877}/demo`

      return config
    },
  },
  reporter: 'cypress-multi-reporters',
  reporterOptions: {
    reporterEnabled: 'mochawesome, mocha-junit-reporter',
    mochawesomeReporterOptions: {
      reportDir: 'test-reports/html',
      reportFilename: '[name]',
      timestamp: 'yyyy-mm-dd_HH-MM-ss',
      overwrite: false,
      html: true,
      json: true,
      charts: true,
      embeddedScreenshots: true,
    },
    mochaJunitReporterReporterOptions: {
      mochaFile: 'test-reports/junit/results-[hash].xml',
      testsuitesTitle: 'Cypress Tests',
      suiteTitleSeparatedBy: ' / ',
      useFullSuiteTitle: true,
      includePending: true,
    },
  },
})
