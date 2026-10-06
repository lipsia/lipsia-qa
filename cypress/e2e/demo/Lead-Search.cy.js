import { demoApp, login, tid } from './_helpers'

describe('Demo · Lead search', demoApp, () => {
  beforeEach(() => login())

  it('lists all seeded leads', () => {
    cy.get(tid('lead-row')).should('have.length', 4)
    cy.get(tid('kpi-total')).should('have.text', '4')
  })

  it('finds a lead by city', () => {
    cy.get(tid('lead-search')).type('Dresden')
    cy.get(tid('lead-row')).should('have.length', 1).and('contain', 'Jonas Brandt')
  })

  it('filters by status', () => {
    cy.get(tid('status-filter')).select('Won')
    cy.get(tid('lead-row')).should('have.length', 1)
    cy.get(tid('lead-status')).each(($status) => expect($status).to.have.text('Won'))
  })

  it('shows a hint when nothing matches', () => {
    cy.get(tid('lead-search')).type('Atlantis')
    cy.get(tid('no-results')).should('be.visible')
  })
})
