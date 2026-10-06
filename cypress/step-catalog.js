/**
 * Step catalog — single source of truth for step-based specs.
 *
 * Read by the specs (through cypress/support/stepFlow.js) and by the E2E Hub
 * (GET /api/step-suites), which renders the "Test steps" selection from it. CommonJS on
 * purpose so both Node and the Cypress bundle can load it.
 *
 * Each key is a suite name. A spec may contain several suites (e.g. one per `context()`).
 *
 *   spec      Spec path relative to the repo root — links the suite to the spec in the UI.
 *   label     Heading shown in the E2E Hub.
 *   steps     Ordered list of steps:
 *     key       Cutoff key. The E2E Hub passes `--env <suite>LastStep=<key>`; every step
 *               after the last entry with that key is skipped. Several entries may share a key.
 *     title     Must match the `it()` title in the spec exactly (checked at runtime).
 *     label     Optional — only entries with a label are selectable in the E2E Hub.
 *     critical  A failure skips all following steps.
 *     group     Assigns the step to a group (see `requires`).
 *     requires  A failure in one of these groups skips this step.
 *
 * Example:
 *
 *   checkout: {
 *     spec: 'cypress/e2e/shop/checkout.cy.js',
 *     label: 'Checkout',
 *     steps: [
 *       { key: 'login', title: 'Log in', label: 'Log in', critical: true },
 *       { key: 'cart', title: 'Add product to cart', label: 'Add product to cart', group: 'cart' },
 *       { key: 'pay', title: 'Pay order', label: 'Pay order', requires: ['cart'] },
 *     ],
 *   },
 */
module.exports = {}
