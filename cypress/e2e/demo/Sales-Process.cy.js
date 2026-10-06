import { createStepFlow } from '../../support/stepFlow'
import { demoApp, login, tid } from './_helpers'

const flow = createStepFlow({ suite: 'demoSalesProcess' })

// Unique per run, so the lead can be found again in later steps.
const leadName = `Demo Customer ${Date.now().toString().slice(-5)}`

// Steps build on each other, so page and storage are kept between them.
context('Demo · Sales process', { ...demoApp, testIsolation: false }, () => {
  beforeEach(function () { flow.beforeEach(this) })
  afterEach(function () { flow.afterEach(this) })

  it('Log in', () => {
    login()
  })

  it('Create lead', () => {
    cy.get(tid('nav-new-lead')).click()
    cy.get(tid('lead-name')).type(leadName)
    cy.get(tid('lead-email')).type('demo.customer@example.com')
    cy.get(tid('lead-zip')).type('04109')
    cy.get(tid('lead-city')).type('Leipzig')
    cy.get(tid('lead-product')).select('Solar system')
    cy.get(tid('lead-consent')).check()
    cy.get(tid('lead-save')).click()
    cy.get(tid('lead-title')).should('have.text', leadName)
    cy.terminalLog(`Lead created: ${leadName}`)
  })

  it('Schedule site visit', () => {
    cy.get(tid('appointment-date')).type('2026-11-12')
    cy.get(tid('appointment-save')).click()
    cy.get(tid('lead-status')).should('have.text', 'Appointment')
    cy.get(tid('lead-appointment')).should('have.text', '2026-11-12')
  })

  it('Send offer', () => {
    cy.get(tid('offer-kwp')).clear().type('9.5')
    cy.get(tid('offer-battery')).check()
    cy.get(tid('offer-code')).type('SUN10')
    // (9.5 × 1,450 € + 4,900 €) − 10 % = 16,807 € (discount rounded)
    cy.get(tid('offer-total')).should('have.text', '€16,807')
    cy.get(tid('offer-send')).click()
    cy.get(tid('lead-status')).should('have.text', 'Offer sent')
    cy.get(tid('lead-offer')).should('contain', '€16,807')
  })

  it('Mark lead as won', () => {
    cy.get(tid('mark-won')).click()
    cy.get(tid('lead-status')).should('have.text', 'Won')
    cy.get(tid('lead-history')).should('contain', 'Lead marked as won')
  })
})
