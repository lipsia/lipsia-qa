/**
 * Suite config for the demo specs: they always target the demo app served by the E2E Hub
 * (`/demo`), whatever stage is selected. Usage: `describe('…', demoApp, () => { … })`.
 */
export const demoApp = { baseUrl: Cypress.expose('demoBaseUrl') }

/** Shorthand for the `data-testid` attributes of the demo app. */
export const tid = (id) => `[data-testid="${id}"]`

/** Signs in to the demo app (fictional demo account). */
export function login(username = 'demo', password = 'demo') {
  cy.visit('/#/login')
  cy.get(tid('login-username')).type(username)
  cy.get(tid('login-password')).type(password, { log: false })
  cy.get(tid('login-submit')).click()
  cy.get(tid('current-user')).should('contain', username)
}
