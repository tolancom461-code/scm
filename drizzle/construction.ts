import {
  int,
  mysqlTable,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  boolean,
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
