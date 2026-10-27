-- Expand-only: dataset metadata, indexed items, and append-only audit events.
-- Lock impact: brief index locks on existing project/board/file tables. Composite keys add no
-- new uniqueness restriction: each already includes the globally unique primary key.
-- Rollback is an explicit maintenance operation after export; never an automatic downgrade.
-- AlterTable
ALTER TABLE "files" ADD COLUMN     "dataset_collection_id" TEXT;

-- CreateTable
CREATE TABLE "data_collections" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "board_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_entries" (
    "collection_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "version_number" INTEGER,
    "member_user_id" TEXT,
    "graph_board_id" TEXT,
    "file_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT,
    "record_id" TEXT,
    "target_record_id" TEXT,
    "version_id" TEXT,
    "template_id" TEXT,
    "evidence_id" TEXT,

    CONSTRAINT "data_entries_pkey" PRIMARY KEY ("collection_id","id")
);

-- CreateTable
CREATE TABLE "data_audits" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_collections_org_id_project_id_deleted_at_id_idx" ON "data_collections"("org_id", "project_id", "deleted_at", "id");

-- CreateIndex
CREATE INDEX "data_collections_deleted_at_purge_after_idx" ON "data_collections"("deleted_at", "purge_after");

-- CreateIndex
CREATE UNIQUE INDEX "data_collections_id_org_id_project_id_key" ON "data_collections"("id", "org_id", "project_id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_kind_deleted_at_id_idx" ON "data_entries"("collection_id", "kind", "deleted_at", "id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_kind_deleted_at_record_id_id_idx" ON "data_entries"("collection_id", "kind", "deleted_at", "record_id", "id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_source_id_idx" ON "data_entries"("collection_id", "source_id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_record_id_idx" ON "data_entries"("collection_id", "record_id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_target_record_id_idx" ON "data_entries"("collection_id", "target_record_id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_version_id_idx" ON "data_entries"("collection_id", "version_id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_template_id_idx" ON "data_entries"("collection_id", "template_id");

-- CreateIndex
CREATE INDEX "data_entries_collection_id_evidence_id_idx" ON "data_entries"("collection_id", "evidence_id");

-- CreateIndex
CREATE INDEX "data_entries_file_id_idx" ON "data_entries"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_entries_collection_id_kind_version_number_key" ON "data_entries"("collection_id", "kind", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "data_entries_collection_id_kind_member_user_id_key" ON "data_entries"("collection_id", "kind", "member_user_id");

-- CreateIndex
CREATE INDEX "data_audits_org_id_project_id_collection_id_id_idx" ON "data_audits"("org_id", "project_id", "collection_id", "id");

-- CreateIndex
CREATE INDEX "data_audits_collection_id_idx" ON "data_audits"("collection_id");

-- CreateIndex
-- safe: includes existing primary key; scheduled brief index lock, no data rewrite.
CREATE UNIQUE INDEX "projects_id_org_id_key" ON "projects"("id", "org_id");

-- CreateIndex
-- safe: includes existing primary key; scheduled brief index lock, no data rewrite.
CREATE UNIQUE INDEX "boards_id_org_id_project_id_key" ON "boards"("id", "org_id", "project_id");

-- CreateIndex
-- safe: new nullable column; scheduled brief index lock, no backfill.
CREATE INDEX "files_dataset_collection_id_idx" ON "files"("dataset_collection_id");

-- CreateIndex
-- safe: includes existing primary key; scheduled brief index lock, no data rewrite.
CREATE UNIQUE INDEX "files_id_org_id_project_id_key" ON "files"("id", "org_id", "project_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_dataset_collection_id_org_id_project_id_fkey" FOREIGN KEY ("dataset_collection_id", "org_id", "project_id") REFERENCES "data_collections"("id", "org_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_collections" ADD CONSTRAINT "data_collections_project_id_org_id_fkey" FOREIGN KEY ("project_id", "org_id") REFERENCES "projects"("id", "org_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_collections" ADD CONSTRAINT "data_collections_board_id_org_id_project_id_fkey" FOREIGN KEY ("board_id", "org_id", "project_id") REFERENCES "boards"("id", "org_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_collections" ADD CONSTRAINT "data_collections_org_id_owner_id_fkey" FOREIGN KEY ("org_id", "owner_id") REFERENCES "memberships"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_collection_id_org_id_project_id_fkey" FOREIGN KEY ("collection_id", "org_id", "project_id") REFERENCES "data_collections"("id", "org_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_org_id_member_user_id_fkey" FOREIGN KEY ("org_id", "member_user_id") REFERENCES "memberships"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_graph_board_id_org_id_project_id_fkey" FOREIGN KEY ("graph_board_id", "org_id", "project_id") REFERENCES "boards"("id", "org_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_file_id_org_id_project_id_fkey" FOREIGN KEY ("file_id", "org_id", "project_id") REFERENCES "files"("id", "org_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_collection_id_source_id_fkey" FOREIGN KEY ("collection_id", "source_id") REFERENCES "data_entries"("collection_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_collection_id_record_id_fkey" FOREIGN KEY ("collection_id", "record_id") REFERENCES "data_entries"("collection_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_collection_id_target_record_id_fkey" FOREIGN KEY ("collection_id", "target_record_id") REFERENCES "data_entries"("collection_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_collection_id_version_id_fkey" FOREIGN KEY ("collection_id", "version_id") REFERENCES "data_entries"("collection_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_collection_id_template_id_fkey" FOREIGN KEY ("collection_id", "template_id") REFERENCES "data_entries"("collection_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_collection_id_evidence_id_fkey" FOREIGN KEY ("collection_id", "evidence_id") REFERENCES "data_entries"("collection_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Domain JSON is validated at the boundary; these guards protect structural invariants too.
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_kind_check" CHECK (
  kind IN ('version','source','record','assertion','evidence','entity_link','relation','saved_view','form_template','member')
);
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_reference_shape" CHECK (
  (kind <> 'record' OR version_id IS NOT NULL) AND
  (kind NOT IN ('assertion','evidence','relation') OR source_id IS NOT NULL) AND
  (kind NOT IN ('assertion','entity_link','relation') OR record_id IS NOT NULL) AND
  (kind <> 'relation' OR (target_record_id IS NOT NULL AND target_record_id <> record_id)) AND
  (kind <> 'member' OR member_user_id IS NOT NULL) AND
  (kind <> 'entity_link' OR graph_board_id IS NOT NULL) AND
  (kind <> 'evidence' OR file_id IS NOT NULL) AND
  (kind <> 'version' OR version_number > 0)
);
CREATE FUNCTION data_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Dataset audit events are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER data_audit_no_update_delete BEFORE UPDATE OR DELETE ON "data_audits"
FOR EACH ROW EXECUTE FUNCTION data_audit_immutable();
