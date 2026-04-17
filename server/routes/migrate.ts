import type { Express } from "express";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

const MIGRATE_SECRET = "taime-migrate-2024-one-time";

export function registerMigrateRoute(app: Express) {
  app.post("/api/admin/db-migrate", async (req, res) => {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${MIGRATE_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();

    try {
      const sqlPath = path.join(process.cwd(), "server", "routes", "_migration_data.sql");
      const rawSql = fs.readFileSync(sqlPath, "utf8");

      // Extract only INSERT statements from the pg_dump output
      const lines = rawSql.split("\n");
      const insertBlocks: string[] = [];
      let current = "";
      let inInsert = false;

      for (const line of lines) {
        if (line.startsWith("INSERT INTO")) {
          inInsert = true;
          current = line;
        } else if (inInsert) {
          current += "\n" + line;
          if (line.endsWith(";")) {
            insertBlocks.push(current);
            current = "";
            inInsert = false;
          }
        }
      }

      await client.query("BEGIN");
      // Disable FK and trigger checks for the migration
      await client.query("SET session_replication_role = 'replica'");

      // Truncate all tables in one shot
      const tableRes = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'sessions'`
      );
      const tables = tableRes.rows.map((r) => r.tablename);
      if (tables.length > 0) {
        await client.query(
          `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
        );
      }

      // Run all INSERT statements
      let count = 0;
      for (const stmt of insertBlocks) {
        await client.query(stmt);
        count++;
      }

      await client.query("SET session_replication_role = 'DEFAULT'");
      await client.query("COMMIT");

      res.json({
        success: true,
        insertStatementsRun: count,
        tablesCleared: tables.length,
      });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Migration error:", err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
      await pool.end();
    }
  });
}
