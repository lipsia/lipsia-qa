/**
 * Logs to the Cypress command log and, in headless runs, to the terminal as well — so the
 * message shows up in the Control Center output and in CI logs.
 * @param {string} text
 */
Cypress.Commands.add('terminalLog', (text) => {
  cy.log(text)
  if (Cypress.browser.isHeadless) cy.task('log', `\t${text}`, { log: false })
})
