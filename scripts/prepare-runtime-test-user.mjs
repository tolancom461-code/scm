import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const password = "RuntimeTest!2026#Secure";
const salt = randomBytes(16).toString("hex");
const derived = await scrypt(password, salt, 64);
console.log(`scrypt$${salt}$${derived.toString("hex")}`);
