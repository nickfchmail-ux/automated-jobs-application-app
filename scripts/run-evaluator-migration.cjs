/* One-off runner: apply the evaluator migration SQL to the remote Supabase DB. */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

// Usage: node scripts/run-evaluator-migration.cjs [migrationFile]
// Defaults to the latest migration (document_versions).
const DEFAULT_MIGRATION = "006_document_versions.sql";
const requested = process.argv[2] || DEFAULT_MIGRATION;

const MIGRATION = path.resolve(
  "d:/Workstation/automated-jobs/next-react/azure/ai-evaluator/migrations",
  requested,
);

const CONN = {
  host: "aws-1-ap-southeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.uqrgivzeklqehuqqqqyv",
  // Credential must come from env — NEVER hardcode a password in source.
  // Set SUPABASE_DB_PASSWORD in your local .env before running this script.
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
};

async function main() {
  const sql = fs.readFileSync(path.resolve(MIGRATION), "utf8");
  const client = new Client(CONN);
  try {
    await client.connect();
    const u = await client
      .query("select current_user as u")
      .then((r) => r.rows[0].u);
    console.log("connected as", u);
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("MIGRATION APPLIED OK");
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {}
    console.error("MIGRATION FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
