import { demoApp, login, tid } from './_helpers'

describe('Demo · Login', demoApp, () => {
  it('signs in with valid credentials', () => {
    login()
    cy.get('h1').should('have.text', 'Leads')
  })

  it('rejects a wrong password', () => {
    cy.visit('/#/login')
    cy.get(tid('login-username')).type('demo')
    cy.get(tid('login-password')).type('wrong-password')
    cy.get(tid('login-submit')).click()
    cy.get(tid('login-error')).should('be.visible').and('contain', 'Invalid username or password')
    cy.url().should('include', '#/login')
  })

  it('signs out again', () => {
    login()
    cy.get(tid('logout')).click()
    cy.get(tid('login-form')).should('be.visible')
  })
})
