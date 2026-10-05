import './commands'

// Prefer stable attributes when Selector Playground / Cypress Studio generate selectors.
Cypress.ElementSelector.defaults({
  selectorPriority: [
    'data-testid',
    'data-cy',
    'data-test',
    'name',
    'attributes',
    'id',
    'tag',
    'class',
    'nth-child',
  ],
})

// Slow mode: `--env delay=<ms>` (Control Center → Speed) pauses after every user-like
// interaction so headed runs can be followed or presented.
const DELAY = Number(Cypress.expose('delay')) || 0

if (DELAY > 0) {
  ;['click', 'dblclick', 'type', 'clear', 'check', 'uncheck', 'select'].forEach((command) => {
    Cypress.Commands.overwrite(command, (originalFn, ...args) =>
      originalFn(...args).then((result) => Cypress.Promise.resolve(result).delay(DELAY)),
    )
  })
}
