import {
  int,
  mysqlTable,
  varchar,
  text,
  mediumtext,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  decimal,
  foreignKey,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import { users } from "./schema";
export const constructionProjects = mysqlTable(
  "pm_projects",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    site: varchar("site", { length: 500 }).notNull().default(""),
    description: text("description").notNull(),
    requirements: text("requirements").notNull(),
    plannedStartDate: varchar("planned_start_date", { length: 10 }),
    plannedEndDate: varchar("planned_end_date", { length: 10 }),
    actualStartDate: varchar("actual_start_date", { length: 10 }),
    forecastEndDate: varchar("forecast_end_date", { length: 10 }),
    actualEndDate: varchar("actual_end_date", { length: 10 }),
    startLocked: boolean("start_locked").notNull().default(false),
    endLocked: boolean("end_locked").notNull().default(false),
    extensionDays: int("extension_days").notNull().default(0),
    extensionReason: text("extension_reason"),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    version: int("version").notNull().default(0),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
  },
  t => [index("pm_projects_status_idx").on(t.status)]
);
export const projectEvents = mysqlTable(
  "pm_project_events",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => constructionProjects.id),
    action: varchar("action", { length: 30 }).notNull(),
    comment: text("comment").notNull(),
    actorId: int("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => [index("pm_event_project_idx").on(t.projectId)]
);
export const employees = mysqlTable("pm_employees", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  jobTitle: varchar("job_title", { length: 200 }).notNull().default(""),
  active: boolean("active").notNull().default(true),
  version: int("version").notNull().default(0),
});
export const taskStatuses = mysqlTable("pm_task_statuses", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  version: int("version").notNull().default(0),
});
export const projectTasks = mysqlTable(
  "pm_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => constructionProjects.id),
    parentId: int("parent_id").references(
      (): AnyMySqlColumn => projectTasks.id
    ),
    name: varchar("name", { length: 255 }).notNull(),
    statusId: int("status_id")
      .notNull()
      .references(() => taskStatuses.id),
    startDate: varchar("start_date", { length: 10 }).notNull(),
    endDate: varchar("end_date", { length: 10 }).notNull(),
    priority: varchar("priority", { length: 20 }).notNull().default("medium"),
    level: int("level").notNull(),
    version: int("version").notNull().default(0),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => [index("pm_tasks_project_idx").on(t.projectId)]
);
export const taskAssignees = mysqlTable(
  "pm_task_assignees",
  {
    id: int("id").autoincrement().primaryKey(),
    taskId: int("task_id")
      .notNull()
      .references(() => projectTasks.id),
    employeeId: int("employee_id")
      .notNull()
      .references(() => employees.id),
  },
  t => [uniqueIndex("pm_task_employee_unique").on(t.taskId, t.employeeId)]
);

export const materialUnits = mysqlTable("pm_material_units", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  nameAr: varchar("name_ar", { length: 100 }).notNull(),
  nameEn: varchar("name_en", { length: 100 }).notNull(),
  nameUr: varchar("name_ur", { length: 100 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: int("version").notNull().default(0),
});

/** Immutable imports from the purchasing catalog; later imports create new snapshots. */
export const materialCatalogEntries = mysqlTable(
  "pm_material_catalog_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceKey: varchar("source_key", { length: 64 }).notNull(),
    externalId: varchar("external_id", { length: 160 }).notNull(),
    catalogCode: varchar("catalog_code", { length: 255 }).notNull(),
    itemName: varchar("item_name", { length: 255 }).notNull(),
    unitId: int("unit_id").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    specifications: text("specifications").notNull(),
    imageStorageKey: varchar("image_storage_key", { length: 500 }),
    imageMimeType: varchar("image_mime_type", { length: 40 }),
    imageChecksum: varchar("image_checksum", { length: 64 }),
    createdBy: int("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => [
    index("pm_catalog_external_idx").on(t.sourceKey, t.externalId),
    foreignKey({
      columns: [t.unitId],
      foreignColumns: [materialUnits.id],
      name: "pm_catalog_unit_fk",
    }),
    foreignKey({
      columns: [t.createdBy],
      foreignColumns: [users.id],
      name: "pm_catalog_creator_fk",
    }),
  ]
);

export const materialRequisitions = mysqlTable(
  "pm_material_requisitions",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    projectId: int("project_id")
      .notNull()
      .references(() => constructionProjects.id),
    taskId: int("task_id").references(() => projectTasks.id),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    externalStatus: varchar("external_status", { length: 40 }),
    externalPurchaseRequestNumber: varchar("external_pr_number", {
      length: 100,
    }),
    externalReferenceUrl: varchar("external_reference_url", { length: 700 }),
    externalMessage: text("external_message"),
    approvedSnapshot: mediumtext("approved_snapshot"),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    approvedBy: int("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at"),
    externalUpdatedAt: timestamp("external_updated_at"),
    version: int("version").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  t => [
    index("pm_material_req_project_idx").on(t.projectId),
    index("pm_material_req_task_idx").on(t.taskId),
    index("pm_material_req_status_idx").on(t.status),
  ]
);

export const materialRequisitionItems = mysqlTable(
  "pm_material_requisition_items",
  {
    id: int("id").autoincrement().primaryKey(),
    requisitionId: int("requisition_id").notNull(),
    sequence: int("sequence").notNull(),
    itemName: varchar("item_name", { length: 255 }).notNull(),
    catalogEntryId: int("catalog_entry_id"),
    catalogCode: varchar("catalog_code", { length: 255 }).notNull().default(""),
    quantity: decimal("quantity", { precision: 18, scale: 9 }).notNull(),
    unitId: int("unit_id").notNull(),
    specifications: text("specifications").notNull(),
    notes: text("notes").notNull(),
    needDate: varchar("need_date", { length: 10 }).notNull(),
    /** Calendar-day offset from the linked task/project start while draft. */
    leadDays: int("lead_days").notNull(),
  },
  t => [
    uniqueIndex("pm_material_req_item_sequence").on(
      t.requisitionId,
      t.sequence
    ),
    index("pm_material_req_item_date_idx").on(t.needDate),
    foreignKey({
      columns: [t.requisitionId],
      foreignColumns: [materialRequisitions.id],
      name: "pm_mr_item_request_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.unitId],
      foreignColumns: [materialUnits.id],
      name: "pm_mr_item_unit_fk",
    }),
    foreignKey({
      columns: [t.catalogEntryId],
      foreignColumns: [materialCatalogEntries.id],
      name: "pm_mr_item_catalog_fk",
    }),
  ]
);

export const ganttProjectSettings = mysqlTable("pm_gantt_project_settings", {
  projectId: int("project_id")
    .primaryKey()
    .references(() => constructionProjects.id),
  workingDays: varchar("working_days", { length: 40 })
    .notNull()
    .default("[0,1,2,3,4]"),
  hoursPerDay: int("hours_per_day").notNull().default(8),
  holidays: text("holidays").notNull(),
  mode: varchar("mode", { length: 20 }).notNull().default("smart"),
  statusDate: varchar("status_date", { length: 10 }),
  deadline: varchar("deadline", { length: 10 }),
  version: int("version").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Exact Gantt Studio document. Kept independent until the final PM/Gantt merge. */
export const ganttStudioStates = mysqlTable("pm_gantt_studio_states", {
  projectId: int("project_id")
    .primaryKey()
    .references(() => constructionProjects.id),
  stateJson: mediumtext("state_json").notNull(),
  version: int("version").notNull().default(0),
  updatedBy: int("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ganttTaskSettings = mysqlTable("pm_gantt_task_settings", {
  taskId: int("task_id")
    .primaryKey()
    .references(() => projectTasks.id),
  notBefore: varchar("not_before", { length: 10 }),
  isMilestone: boolean("is_milestone").notNull().default(false),
  plannedStartDate: varchar("planned_start_date", { length: 10 }),
  plannedEndDate: varchar("planned_end_date", { length: 10 }),
  actualStartDate: varchar("actual_start_date", { length: 10 }),
  actualEndDate: varchar("actual_end_date", { length: 10 }),
  startLocked: boolean("start_locked").notNull().default(false),
  endLocked: boolean("end_locked").notNull().default(false),
  version: int("version").notNull().default(0),
});

export const ganttSharedTaskGroups = mysqlTable("pm_gantt_shared_task_groups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  syncDates: boolean("sync_dates").notNull().default(true),
  syncStatus: boolean("sync_status").notNull().default(true),
  syncAssignees: boolean("sync_assignees").notNull().default(false),
  version: int("version").notNull().default(0),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ganttSharedTaskMembers = mysqlTable(
  "pm_gantt_shared_task_members",
  {
    id: int("id").autoincrement().primaryKey(),
    groupId: int("group_id").notNull(),
    taskId: int("task_id").notNull(),
  },
  t => [
    uniqueIndex("pm_gantt_shared_member_task_unique").on(t.taskId),
    uniqueIndex("pm_gantt_shared_member_unique").on(t.groupId, t.taskId),
    index("pm_gantt_shared_member_group_idx").on(t.groupId),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [ganttSharedTaskGroups.id],
      name: "pm_gantt_member_group_fk",
    }),
    foreignKey({
      columns: [t.taskId],
      foreignColumns: [projectTasks.id],
      name: "pm_gantt_member_task_fk",
    }),
  ]
);

export const ganttTaskLinks = mysqlTable(
  "pm_gantt_task_links",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => constructionProjects.id),
    fromTaskId: int("from_task_id")
      .notNull()
      .references(() => projectTasks.id),
    toTaskId: int("to_task_id")
      .notNull()
      .references(() => projectTasks.id),
    type: varchar("type", { length: 2 }).notNull().default("FS"),
    lagDays: int("lag_days").notNull().default(0),
    version: int("version").notNull().default(0),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => [
    index("pm_gantt_links_project_idx").on(t.projectId),
    uniqueIndex("pm_gantt_link_unique").on(
      t.projectId,
      t.fromTaskId,
      t.toTaskId,
      t.type
    ),
  ]
);

export const ganttBaselines = mysqlTable(
  "pm_gantt_baselines",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => constructionProjects.id),
    name: varchar("name", { length: 160 }).notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => [index("pm_gantt_baseline_project_idx").on(t.projectId)]
);

export const ganttBaselineTasks = mysqlTable(
  "pm_gantt_baseline_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    baselineId: int("baseline_id")
      .notNull()
      .references(() => ganttBaselines.id),
    // A captured identity remains meaningful after the live task is deleted.
    taskId: int("task_id").notNull(),
    taskName: varchar("task_name", { length: 255 }).notNull(),
    startDate: varchar("start_date", { length: 10 }).notNull(),
    endDate: varchar("end_date", { length: 10 }).notNull(),
    durationDays: int("duration_days").notNull(),
  },
  t => [
    index("pm_gantt_baseline_task_idx").on(t.baselineId),
    uniqueIndex("pm_gantt_baseline_task_unique").on(t.baselineId, t.taskId),
  ]
);
