import "dotenv/config";

import {
  createLocalUser,
  getUserByUsername,
  seedPermissions,
} from "../server/db";
import { hashPassword } from "../server/localAuth";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME?.trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_NAME?.trim() || "System Owner";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL غير موجود في ملف .env");
  }
  if (
    !ADMIN_USERNAME ||
    !/^[a-z0-9._-]{3,80}$/.test(ADMIN_USERNAME) ||
    !ADMIN_PASSWORD ||
    ADMIN_PASSWORD.length < 12
  ) {
    throw new Error(
      "Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters), or use first-run setup."
    );
  }

  await seedPermissions();

  const existing = await getUserByUsername(ADMIN_USERNAME);
  if (existing) {
    console.log("حساب ADMIN موجود بالفعل. لم يتم إنشاء حساب مكرر.");
    return;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const userId = await createLocalUser({
    username: ADMIN_USERNAME,
    passwordHash,
    name: ADMIN_NAME,
    role: "admin",
    locale: "ar",
  });

  console.log("تم إنشاء حساب المدير بنجاح.");
  console.log(`User ID: ${userId}`);
  console.log(`Username: ${ADMIN_USERNAME}`);
  console.log("Role: admin (صلاحيات إدارية كاملة)");
}

main().catch(error => {
  console.error("فشل إنشاء حساب المدير:");
  console.error(error);
  process.exit(1);
});
