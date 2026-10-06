import { demoApp, login, tid } from './_helpers'

// 8 kWp × 1,450 € = 11,600 € without battery storage.
describe('Demo · Offer discounts', demoApp, () => {
  beforeEach(() => {
    login()
    cy.get(tid('lead-search')).type('Peter Wolff')
    cy.get(tid('lead-row')).click()
    cy.get(tid('offer-kwp')).clear().type('8')
    cy.get(tid('offer-battery')).uncheck()
    cy.get(tid('offer-subtotal')).should('have.text', '€11,600')
  })

  it('applies SUN10 as 10 % off', () => {
    cy.get(tid('offer-code')).type('SUN10')
    cy.get(tid('offer-discount')).should('have.text', '− €1,160')
    cy.get(tid('offer-total')).should('have.text', '€10,440')
  })

  it('rejects an unknown code', () => {
    cy.get(tid('offer-code')).type('FREESOLAR')
    cy.get(tid('offer-error')).should('be.visible')
  })

  // Fails on purpose: the demo app takes 50 % off instead of 50 €. Shows how a real
  // regression appears in the E2E Hub (result, failure reason, screenshot).
  it('applies WELCOME50 as 50 € off (known bug)', () => {
    cy.get(tid('offer-code')).type('WELCOME50')
    cy.get(tid('offer-discount'), { timeout: 3000 }).should('have.text', '− €50')
    cy.get(tid('offer-total')).should('have.text', '€11,550')
  })
})
