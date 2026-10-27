// Legacy review records must remain testable while anonymous registration is disabled.
export function seedPerson(person, { familyId = 0, pending = true } = {}) {
    return cy.dbQuery(
        `INSERT INTO person_per
            (per_FirstName, per_LastName, per_Email, per_Gender, per_fmr_ID, per_fam_ID,
             per_EnteredBy, per_NeedsReview, per_DateEntered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [person.firstName, person.lastName, person.email ?? "", person.gender ?? 1,
            person.role ?? 0, familyId, pending ? -1 : 1, pending ? 1 : 0],
    ).then(({ rows, error }) => {
        expect(error, "person fixture").to.eq(null);
        return { Id: rows.insertId };
    });
}

export function seedFamily(family, { pending = true } = {}) {
    return cy.dbQuery(
        `INSERT INTO family_fam
            (fam_Name, fam_Address1, fam_Address2, fam_City, fam_State, fam_Country,
             fam_Zip, fam_HomePhone, fam_Email, fam_EnteredBy, fam_NeedsReview, fam_DateEntered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [family.Name, family.Address1 ?? "", family.Address2 ?? "", family.City ?? "",
            family.State ?? "", family.Country ?? "US", family.Zip ?? "", family.HomePhone ?? "",
            family.Email ?? "", pending ? -1 : 1, pending ? 1 : 0],
    ).then(({ rows, error }) => {
        expect(error, "family fixture").to.eq(null);
        const Id = rows.insertId;
        return cy.wrap(family.people ?? [], { log: false })
            .each((person) => seedPerson(person, { familyId: Id, pending }))
            .then(() => ({ Id }));
    });
}
