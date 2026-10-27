# ADR-004 — Data Collections live outside board documents

Status: accepted for the Data Intelligence model (stage 01).

A collection is a project-owned dataset, not a graph or a board template. The domain contract is
`packages/domain/src/datasets/`; `DatasetRepository` has paged reads, collection CRUD, atomic
`commit` batches, immutable audit references and an explicit retention purge. All writes require
an expected collection revision. An item ID cannot change kind; ordinary upserts cannot resurrect a tombstone.
Soft-deleted items can be restored in an atomic batch; collection restore is limited to its retention window.
Collection IDs remain reserved by the immutable audit ledger even after purge.

## Storage and trust boundaries

- Local: upgrade `raven-workspace` IndexedDB from version 1 to 2, preserving projects and boards.
  Add indexed collections/items/audit stores. Parent metadata and dataset writes use one native
  transaction, so a concurrent parent deletion cannot orphan a collection. Evidence bytes use the
  existing OPFS/IndexedDB BlobStore, in a namespace hashed from workspace/owner/project/board/
  collection. An in-memory fallback is refused for evidence. No local operation uses a server.
- Server: additive Prisma migration `0011_data_collections` adds `DataCollection`, `DataEntry` and
  `DataAudit`. Typed JSON payloads retain extension fields; normalized columns enforce composite
  collection/org/project/reference FKs and support indexed pagination, version uniqueness and
  membership grants. Verified, collection-owned `File` rows bind objects to the same project and
  collection. Object storage remains the existing signed S3 upload/complete/download pipeline.
- The API derives org/actor from the authenticated context and rechecks actual, joined membership,
  active user/org/project and collection permissions inside database transactions. Viewers cannot
  write. Private/restricted collections require owner/admin or an explicit collection grant;
  granting membership, changing collection policy and deleting/purging require owner/admin.
  The ordinary file API applies the same permissions, hides dataset files from the project-wide
  file listing, and isolates hash deduplication by project and collection. Evidence downloads are
  attachments. Dataset completion computes the actual full-object SHA-256 in bounded chunks.
- A collection transaction uses a revision CAS and Serializable isolation. Related rows may arrive
  in any batch order; the server writes them in reference order. Invalid references, collisions or
  concurrent changes roll back data, revision and audit together. Source/template/version deletion
  cannot leave live references. Sources are mandatory for assertions and relations.

`DatasetVersion` describes an import/schema revision; sealing freezes that descriptor. It is not
an automatic full snapshot of every past record edit. Separate assertions preserve contradictory
claims; no record-linking operation merges identities. `observed`, `claimed` and `inferred` are
independent of the assessment's confidence, assessor, time and rationale. Source origin, author,
observation/import time, URL/hash, licence, lawful basis and restrictions are distinct metadata.
These fields record an analyst's declarations, not an approval of a third-party API licence.

## Graph, exports and bounds

A `RecordEntityLink` is a reviewed or proposed reference to a board/node. Board/project scope is
checked; node IDs are soft references because Y.Doc is authoritative and a projection may become
stale. The repository never loads or mutates a board document. Applying a graph projection remains
an explicit Proposal/accept/undo operation in the later graph stage. No source node type, second
canvas, person-schema change or new Y.Doc root is introduced here.

Reads return at most 200 entities (default 50), using keyset cursors. Records are individual rows,
not an array in a collection payload. IndexedDB tests seed 100,000 rows, forbid unbounded `getAll`
and graph access, and check that one page needs at most page-size plus two cursor advances.
A commit contains at most 100 mutations. JSON items are bounded to 1 MiB and 32 nesting levels;
paged JSON interchange (`raven.dataset.page.v1`) is bounded to 200 items / 16 MiB. Export every
page to transfer a larger dataset. `mapDatasetItem` is the shared domain/storage mapper.

[The synthetic example](../examples/dataset.page.v1.json) contains no real personal data and
includes future extension fields. `importDatasetPage(exportDatasetPage(page))` preserves them.
This is an interchange codec; the reviewed tabular-import wizard is stage 03. Existing `.raven`
board formats, Y.Doc schema version 1 and person nodes keep their existing codecs and tests.

## Retention and recovery

Soft deletion hides a collection immediately and records `purgeAfter` using its retention policy.
After that deadline, an owner/admin may explicitly purge. A persistent local staging ledger tracks
object writes across crashes. Local purge removes evidence bytes before deleting metadata. Server purge first tombstones its exclusively owned files, removes
objects and variants, then deletes item/file/collection rows in a transaction. Failed object
removal keeps metadata available to a retry; S3 404 is idempotent, other failed DELETE responses
are errors. Audit events contain identifiers/revisions, not a copy of personal field values, and
remain immutable (database trigger on server). Audit retention is a separate operator policy.
Projects/boards with retained datasets or active projection references cannot be deleted/moved
until the references are removed and retained collections purged. Composite FKs also restrict
scope changes on server. This avoids silently reassigning JSON provenance to another project.

The IndexedDB upgrade is additive and does not touch Y.Doc databases or their OPFS files. The SQL
migration adds nullable file ownership and new tables/indexes; it does not rewrite existing data.
To roll back, stop dataset writes, export all pages and evidence, validate restoration elsewhere,
and retire the new structures in a separate reviewed maintenance migration. There is no automatic
lossless downgrade from workspace DB v2 to an older client or destructive SQL rollback script.
An older IndexedDB client receives a version error rather than writing an incompatible database.

## Design references and executed acceptance checks

PROV-O's entity/activity/agent vocabulary motivates separate record/assertion/source/evidence,
version/import activity and author/actor references. This is a JSON application model, not a claim
of RDF/PROV conformance. The supplied [PROV-O URL](https://www.w3.org/TR/prov-o/),
[OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
and [OpenRefine reconciliation reference](https://openrefine.org/docs/technical-reference/reconciliation-api)
were inaccessible through the onboarding proxy; no closed text is represented as fully read.
The concrete constraints are independently verified by the repository's tests:

- Domain: round-trip extensions, required fact sources, contradictory assertions, explicit identity
  assessment, sealed descriptors, reference integrity, JSON/size limits and retention deadlines.
- Local adapter: real IndexedDB transactions, v1 metadata upgrade, reopen durability, namespaces,
  concurrent parent deletion, unique-index rollback, OPFS seam/checksum and a 100k-row indexed read.
- Server integration: actual disposable PostgreSQL, CRUD, memberships, cross-org/reference FKs,
  concurrent writers, atomic rollback, immutable audit trigger, file ACLs, retryable retention purge
  and explicit API errors. S3 tests cover signed byte ranges and deletion failures.
- Browser E2E: authenticated server CRUD survives reload without creating canvas nodes; local
  IndexedDB and actual OPFS retain records/evidence with fetch/XHR/WebSocket forbidden.

Forms UI, record-table UI, file extraction, reconciliation scoring and graph projection actions
are intentionally subsequent stages, not hidden or simulated controls in this change.
