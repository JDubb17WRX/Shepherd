describe('Shepherd account request', () => {
  it('shows branded Sign In and Sign Up choices', () => {
    cy.visit('/session/begin');
    cy.contains('h1', 'Shepherd').should('be.visible');
    cy.contains('a', 'Sign Up').should('have.attr', 'href').and('include', '/session/signup');
  });

  it('collects the required request fields without granting access', () => {
    cy.visit('/session/signup');
    cy.contains('h2', 'Request an account').should('be.visible');
    cy.get('input[name="first_name"]').should('have.attr', 'required');
    cy.get('input[name="last_name"]').should('have.attr', 'required');
    cy.get('input[name="email"]').should('have.attr', 'type', 'email');
    cy.get('input[name="username"]').should('have.attr', 'required');
    cy.get('textarea[name="note"]').should('exist');
    cy.contains('Verify your email, then wait for an administrator').should('be.visible');
  });
});
