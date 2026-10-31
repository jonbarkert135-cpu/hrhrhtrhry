# ADR-005 — Published form versions retain their meaning

Status: accepted — Data Intelligence stage 02A (2026-10-31)

A form template is a collection item, separate from board templates and Y.Doc. New publications
carry `templateFormat: raven.form.v1`, a family ID and an explicit version. Their ID is derived
from family/version, so the existing scoped primary key prevents duplicate versions. Published
content is immutable; publishing an edit creates another item. Records retain their exact
`templateId`. Renaming or reordering a field retains its ID; type changes are shown before saving.
There is no automatic record conversion or identity merge.

Legacy templates keep their previous codec and extension fields. The marker opts new templates
into the stricter contract rather than reinterpreting an unknown legacy extension. Legacy IDs
map to a bounded deterministic family key when a new version is created. No SQL, IndexedDB or
board-format migration is required. Ordinary soft-delete/restore and reference checks still apply.

The builder and typed preview use the existing seven field types. Validation is bounded, reports
field-specific errors and preserves raw values separately from normalized values. False and zero
are values; blank input is distinct. Preview values stay in component state. Saving a template
stores its definition, not preview data. Manual record persistence remains a separate stage-02
vertical slice; this change exposes no placeholder record/import controls.

Local UI uses the existing IndexedDB DatasetRepository. Server UI uses its existing tRPC adapter;
actor/org come from the session, with query/state scope per actor and organization. Collection
write affordances use an access query backed by the same repository permission checks as writes.
The API rechecks authorization when saving; a disabled button is not an authorization boundary.
Paged form reads do not open a board document or read the collection's record table.

References reviewed for these decisions:

- [W3C PROV-O](https://www.w3.org/TR/prov-o/), Entity, Activity, Agent and Revision definitions,
  read from the [official 30-April-2013 recommendation archive](https://github.com/w3c/prov/blob/master/ontology/releases/REC-prov-o-20130430/Overview.html).
  Fixed aspects motivate a new entity per publication, with existing audit activity/actor references.
  This is an application JSON model, not a claim of RDF/PROV conformance.
- [OWASP ASVS 5.0.0 V2](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x11-V2-Validation-and-Business-Logic.md),
  selected controls 2.2.1–2.2.3: schema allow lists, trusted validation and contextual ID/version checks.
- [ASVS V8](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md),
  selected controls 8.2.2, 8.3.1 and 8.4.1: collection authorization, server enforcement and tenant isolation.

Acceptance checks cover immutable versions and collisions, stable IDs, legacy/unknown-field
round trips, typed preview limits, viewer/foreign-org denial, local operation with outbound
transports forbidden, and a browser create → edit → preview → publish → reload journey.

Validation executed: 3,685 unit/integration tests passed (seven pre-existing runner environment
sentinels skipped); the complete new local and server browser journeys passed, including mobile
bounds, reduced motion and axe checks. Changed form source files exceed the 80% line-coverage gate.
Lint, typecheck/build, architectural boundaries, display-copy, runtime-source, migration and secret
gates pass. No test gate or dependency version was changed. Native local verification used system
Chromium with software WebGL; CI retains the repository's pinned Playwright browser.
