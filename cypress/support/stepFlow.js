import STEP_CATALOG from '../step-catalog'

/**
 * Step mechanics for specs listed in cypress/step-catalog.js.
 *
 * Usage (createStepFlow must run at module scope, before `context()`):
 *
 *     const flow = createStepFlow({ suite: 'checkout' })
 *
 *     context('Checkout', () => {
 *       before(function () { if (flow.dryRun) return; … })
 *       beforeEach(function () { flow.beforeEach(this) })
 *       afterEach(function () { flow.afterEach(this) })
 *
 *       it('Log in', () => { … })
 *       it('Add product to cart', () => { … })
 *     })
 *
 * Every step must be a literal `it('title', () => { … })` call. Cypress Studio can only save
 * a recording when it finds that call at the line Mocha reports for the test — wrappers
 * (`stepIt(...)`) or tests generated in a loop break saving.
 *
 * Features:
 * - Cutoff: `--env <suite>LastStep=<key>` runs steps up to and including that key. The value
 *   `none` is a dry run: every step is skipped and nothing touches the system under test.
 * - Prerequisites: when a run starts in the middle of the suite (Studio, single-test re-run,
 *   `it.only`), the bodies of all earlier steps are replayed first.
 * - Failure gating via `critical`, `group` and `requires` from the catalog.
 * - Catalog check: every catalog title must exist as an `it()` in the spec.
 *
 * Step bodies that read state set by an earlier step must do so inside `cy.then(() => …)`:
 * replayed prerequisites only enqueue commands, so the state is not set yet while the body
 * is being built.
 */

// Test bodies are captured while tests are registered. At hook time Cypress may already have
// pruned `suite.tests` (Studio, spec filter, `it.only`), so they cannot be read from there.
const capturedBodies = new Map()
let originalIt = null

function installBodyCapture() {
    const target = typeof window !== 'undefined' ? window : globalThis
    if (originalIt || typeof target.it !== 'function') return
    originalIt = target.it

    const capture = (title, args) => {
        const fn = args.find((arg) => typeof arg === 'function')
        if (typeof title === 'string' && fn) capturedBodies.set(title, fn)
    }
    const wrapped = function (title, ...rest) {
        capture(title, rest)
        return originalIt.apply(this, [title, ...rest])
    }
    Object.assign(wrapped, originalIt)
    ;['only', 'skip'].forEach((variant) => {
        if (typeof originalIt[variant] !== 'function') return
        wrapped[variant] = function (title, ...rest) {
            capture(title, rest)
            return originalIt[variant].apply(this, [title, ...rest])
        }
    })
    target.it = wrapped
}

function restoreIt() {
    if (!originalIt) return
    const target = typeof window !== 'undefined' ? window : globalThis
    target.it = originalIt
    originalIt = null
}

/**
 * @param {object}   opts
 * @param {string}   opts.suite          Key in cypress/step-catalog.js
 * @param {string}   [opts.cutoffEnvKey] Env key holding the last step key (default `<suite>LastStep`)
 * @param {function} [opts.isEnabled]    (step) => boolean — steps that do not apply to this run
 * @param {function} [opts.onFailure]    (ctx) => void — recovery after a failed step
 */
export function createStepFlow({ suite, cutoffEnvKey = `${suite}LastStep`, isEnabled, onFailure }) {
    const entry = STEP_CATALOG[suite]
    if (!entry) throw new Error(`createStepFlow: unknown suite '${suite}' — known: ${Object.keys(STEP_CATALOG).join(', ') || 'none'}`)
    const steps = entry.steps || []

    installBodyCapture()

    const indexByTitle = new Map(steps.map((s, i) => [s.title, i]))
    const stepEnabled = (step) => (isEnabled ? Boolean(isEnabled(step)) : true)

    // "Up to key X" means up to the LAST entry with that key.
    const rawCutoff = String(Cypress.expose(cutoffEnvKey) || '').trim()
    const dryRun = rawCutoff === 'none'
    const cutoffIndex = (() => {
        if (dryRun) return -1
        if (!rawCutoff) return steps.length - 1
        let last = -1
        steps.forEach((s, i) => { if (s.key === rawCutoff) last = i })
        return last === -1 ? steps.length - 1 : last
    })()

    // eslint-disable-next-line no-console
    console.log(
        `[${suite}] ${cutoffEnvKey}='${rawCutoff || '(empty → full run)'}' → ` +
        (dryRun
            ? 'dry run, no step is executed'
            : `running steps 1..${cutoffIndex + 1} of ${steps.length}`),
    )

    const done = new Set()
    const failedGroups = new Set()
    let abortAll = false
    let catalogueChecked = false

    function checkCatalogue() {
        if (catalogueChecked) return
        catalogueChecked = true
        const missing = steps.filter((s) => !capturedBodies.has(s.title)).map((s) => s.title)
        if (missing.length) {
            throw new Error(
                `Step catalog and spec are out of sync (${suite}): no it() found for ` +
                `${missing.map((t) => `"${t}"`).join(', ')}. Titles in cypress/step-catalog.js must match ` +
                `the spec exactly, and createStepFlow(...) must be called before context(...).`,
            )
        }
    }

    function skipStep(ctx, reason) {
        cy.log(`⏭️ ${ctx.currentTest.title} — ${reason}`)
        ctx.skip()
    }

    function replayPrerequisites(ctx, idx) {
        for (let i = 0; i < idx; i++) {
            const step = steps[i]
            if (done.has(step.title) || !stepEnabled(step)) continue
            const body = capturedBodies.get(step.title)
            if (!body) {
                throw new Error(
                    `Prerequisite "${step.title}" was not captured. Is createStepFlow(...) called at module ` +
                    `scope before context(...), and is the step a literal it('${step.title}', () => { … })?`,
                )
            }
            cy.log(`↺ Prerequisite: ${step.title}`)
            body.call(ctx)
            done.add(step.title)
        }
    }

    return {
        /** True for `--env <cutoffEnvKey>=none`; specs should skip their before() hook. */
        dryRun,

        /**
         * Marks steps as done without running them — for prerequisites already satisfied
         * from outside the suite.
         * @param {...string} keys Cutoff keys from the catalog
         */
        markDone(...keys) {
            keys.forEach((key) => {
                const matches = steps.filter((s) => s.key === key)
                if (!matches.length) throw new Error(`markDone: unknown step key '${key}' in suite '${suite}'`)
                matches.forEach((s) => done.add(s.title))
            })
        },

        /** Call from `beforeEach(function () { flow.beforeEach(this) })`. */
        beforeEach(ctx) {
            restoreIt()
            const test = ctx.currentTest
            checkCatalogue()

            if (dryRun) return skipStep(ctx, 'dry run (cutoff = none)')
            if (abortAll) return skipStep(ctx, 'a critical step failed earlier')

            const idx = indexByTitle.get(test.title)
            // Tests not listed in the catalog run outside the step chain.
            if (idx === undefined) return

            if (done.has(test.title)) return skipStep(ctx, 'already done')

            const step = steps[idx]
            if (!stepEnabled(step)) return skipStep(ctx, 'not enabled in this run')
            if (idx > cutoffIndex) return skipStep(ctx, `after cutoff '${rawCutoff}'`)
            const blocking = (step.requires || []).filter((g) => failedGroups.has(g))
            if (blocking.length) return skipStep(ctx, `group '${blocking.join(', ')}' failed`)

            replayPrerequisites(ctx, idx)
        },

        /** Call from `afterEach(function () { flow.afterEach(this) })`. */
        afterEach(ctx) {
            const test = ctx.currentTest
            const idx = indexByTitle.get(test.title)
            if (idx === undefined) return
            // Failed steps count as done too, so they are not replayed as a prerequisite.
            done.add(test.title)

            if (test.state !== 'failed') return
            const step = steps[idx]
            if (step.critical) abortAll = true
            if (step.group) failedGroups.add(step.group)
            if (onFailure) onFailure(ctx)
        },
    }
}

export default createStepFlow
