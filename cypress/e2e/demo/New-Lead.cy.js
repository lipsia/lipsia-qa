import { demoApp, login, tid } from './_helpers'

describe('Demo · New lead', demoApp, () => {
  beforeEach(() => {
    login()
    cy.get(tid('new-lead')).click()
  })

  it('validates required fields', () => {
    cy.get(tid('lead-save')).click()
    cy.get(tid('form-error'))
      .should('contain', 'Name is required.')
      .and('contain', 'Postcode must have 5 digits.')
      .and('contain', 'Contact consent is required.')
    cy.url().should('include', '#/leads/new')
  })

  it('creates a lead and shows it in the list', () => {
    cy.get(tid('lead-name')).type('Clara Hoffmann')
    cy.get(tid('lead-email')).type('clara.hoffmann@example.com')
    cy.get(tid('lead-phone')).type('0341 555 0199')
    cy.get(tid('lead-zip')).type('04277')
    cy.get(tid('lead-city')).type('Leipzig')
    cy.get(tid('lead-product')).select('Solar system + battery')
    cy.get(tid('lead-consent')).check()
    cy.get(tid('lead-save')).click()

    cy.get(tid('toast')).should('contain', 'Lead "Clara Hoffmann" created')
    cy.get(tid('lead-title')).should('have.text', 'Clara Hoffmann')
    cy.get(tid('lead-status')).should('have.text', 'New')

    cy.get(tid('nav-leads')).click()
    cy.get(tid('kpi-total')).should('have.text', '5')
    cy.get(tid('lead-row')).first().should('contain', 'Clara Hoffmann')
  })
})
