/**
 * Access to the stage selected via `systemUnderTest` (cypress.env.json or `--env`).
 * `cy.visit('/')` already targets the stage's baseUrl; use this for everything else a
 * stage defines (API URLs, feature flags, …).
 */
export const stageName = Cypress.expose('systemUnderTest')

export const stage = (Cypress.expose('stages') || {})[stageName]

if (!stage) {
  throw new Error(`Unknown systemUnderTest "${stageName}" — it must match a key of "stages" in cypress.env.json.`)
}

/**
 * Yields a value from the private `secrets` block of cypress.env.json.
 * @param {string} key
 */
export function secret(key) {
  return cy.env(['secrets']).then(({ secrets }) => (secrets || {})[key])
}
