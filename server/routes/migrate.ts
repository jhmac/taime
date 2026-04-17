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

      // Extract INSERT statements in dump order (pg_dump already orders by FK deps)
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

      // Truncate all tables with CASCADE (handles FK ordering automatically)
      const tableRes = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'sessions'`
      );
      const tables = tableRes.rows.map((r) => r.tablename);

      await client.query("BEGIN");

      if (tables.length > 0) {
        // Truncate with CASCADE — PostgreSQL resolves FK order automatically
        await client.query(
          `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`
        );
      }

      // Insert in dump order (pg_dump ensures parent tables come before children)
      let count = 0;
      for (const stmt of insertBlocks) {
        await client.query(stmt);
        count++;
      }

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
