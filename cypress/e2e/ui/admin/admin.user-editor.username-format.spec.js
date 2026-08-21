/// <reference types="cypress" />

/**
 * Shepherd logins must be names, not email addresses.
 *
 * The bulletin console identifies people by username and its roles file admits
 * only [a-z0-9._-]{3,50}. A login containing `@` can never appear there, so the
 * account authenticates to Shepherd normally and is then refused by the console
 * with nothing on screen to explain why.
 *
 * The editor used to pre-fill this field with the person's email address, which
 * is how such logins came to exist in the first place — so the pre-fill is
 * tested here alongside the validation. Fixing only the validation would leave
 * administrators fighting a form that suggests a value it then rejects.
 */
describe('Administrator user editor username format', () => {
    // Ivan Hart. Chosen because no other spec touches this person, and because
    // the local part of his address differs from his name, so the pre-fill
    // assertion cannot pass by coincidence.
    const personId = 13;
    const personEmail = 'ivan.hayes@example.com';
    const suggestedUserName = 'ivan.hayes';

    function deleteTestUser() {
        cy.makePrivateAdminAPICall('DELETE', `/admin/api/user/${personId}`, null, [200, 204, 404]);
        cy.setupAdminSession({ forceLogin: true });
    }

    beforeEach(() => {
        deleteTestUser();
        cy.visit(`admin/system/users/new?personId=${personId}`);
        cy.contains('User Editor');
    });

    after(() => {
        deleteTestUser();
    });

    it('suggests a login derived from the address rather than the address itself', () => {
        cy.get('#UserName').should('have.value', suggestedUserName);
        cy.get('#UserName').invoke('val').should('not.contain', '@');
    });

    it('refuses an email address as a login and says why', () => {
        cy.get('#UserName').clear().type(personEmail);
        cy.get('#SaveButton').click();

        // Still on the editor, with an explanation naming the actual problem.
        cy.contains('User Editor');
        cy.contains('Email addresses cannot be used as logins');
        cy.get('#UserName').should('have.value', personEmail);

        // And nothing was written.
        cy.visit('admin/system/users');
        cy.get('#user-listing-table').should('exist');
        cy.get('#user-listing-table tbody').should('not.contain.text', personEmail);
    });

    it('accepts a conforming login', () => {
        cy.get('#UserName').clear().type(suggestedUserName);
        cy.get('#SaveButton').click();

        cy.visit('admin/system/users');
        cy.get('.dt-search input').type('Ivan Hart');
        cy.get('#user-listing-table tbody').should('contain.text', 'Ivan Hart');
    });

    it('refuses renaming an existing account to an email address', () => {
        cy.get('#UserName').clear().type(suggestedUserName);
        cy.get('#SaveButton').click();

        cy.visit(`admin/system/users/${personId}/edit`);
        cy.get('#UserName').clear().type('renamed.away@example.com');
        cy.get('#SaveButton').click();
        cy.contains('Email addresses cannot be used as logins');

        cy.visit(`admin/system/users/${personId}/edit`);
        cy.get('#UserName').should('have.value', suggestedUserName);
    });

    it('still lets an administrator edit an account created before the rule existed', () => {
        // Accounts like this predate the rule and are exactly what a hard
        // enforcement on save would strand: the login cannot be used with the
        // console, but locking an administrator out of the permission
        // checkboxes until they rename it helps nobody. Manufactured directly
        // in the row, because the editor now refuses to create one.
        cy.get('#UserName').clear().type(suggestedUserName);
        cy.get('#SaveButton').click();
        cy.task('forceUserName', { personId, userName: personEmail }).should('eq', 1);

        cy.visit(`admin/system/users/${personId}/edit`);
        cy.get('#UserName').should('have.value', personEmail);
        cy.get('#SaveButton').click();

        cy.contains('Email addresses cannot be used as logins').should('not.exist');
        cy.visit(`admin/system/users/${personId}/edit`);
        cy.get('#UserName').should('have.value', personEmail);
    });
});
