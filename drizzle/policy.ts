import { constructionProjects } from "./construction";
import {
  boolean,
  index,
  int,
  mysqlTable,
  timestamp,
  varchar,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { users } from "./schema";
import { simpleProjects } from "./phase-one";
export const accessProfiles = mysqlTable("access_profiles", {
  userId: int("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  template: varchar("template", { length: 30 }).default("custom").notNull(),
  allProjects: boolean("all_projects").default(false).notNull(),
  version: int("version").default(1).notNull(),
});
export const accessProjects = mysqlTable(
  "access_projects",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => accessProfiles.userId, { onDelete: "cascade" }),
    projectId: int("project_id")
      .notNull()
      .references(() => simpleProjects.id, { onDelete: "cascade" }),
  },
  t => [
    uniqueIndex("access_user_project_unique").on(t.userId, t.projectId),
    index("access_project_idx").on(t.projectId),
  ]
);
export const accessDenials = mysqlTable(
  "access_denials",
  {
    id: int("id").autoincrement().primaryKey(),
    actorId: int("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    path: varchar("path", { length: 160 }).notNull(),
    reason: varchar("reason", { length: 60 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("access_denial_actor_time").on(t.actorId, t.createdAt)]
);

export const accessConstructionProjects = mysqlTable(
  "access_construction_projects",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => accessProfiles.userId, { onDelete: "cascade" }),
    projectId: int("project_id")
      .notNull()
      .references(() => constructionProjects.id, { onDelete: "cascade" }),
  },
  t => [
    uniqueIndex("access_pm_user_project_unique").on(t.userId, t.projectId),
    index("access_pm_project_idx").on(t.projectId),
  ]
);
