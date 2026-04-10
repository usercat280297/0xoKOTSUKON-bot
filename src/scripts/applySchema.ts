import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDatabaseUrl } from "../config/env";
import { createPool } from "../db/pool";

async function main(): Promise<void> {
  const pool = createPool(getDatabaseUrl());

  try {
    const sql = await readFile(join(process.cwd(), "src/db/schema.sql"), "utf8");
    await pool.query(sql);
    console.log("Database schema applied.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Failed to apply schema.", error);
  process.exitCode = 1;
});
