import fs from "fs";
import path from "path";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export function validateMigrationJournal(): void {
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    console.error("[migrations] FATAL: migrations/meta/_journal.json not found");
    process.exit(1);
  }

  let journal: Journal;
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  } catch (err) {
    console.error("[migrations] FATAL: Failed to parse _journal.json:", err);
    process.exit(1);
  }

  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.basename(f, ".sql"))
    .sort();

  const journalTags = new Set(journal.entries.map((e) => e.tag));
  const sqlFileSet = new Set(sqlFiles);

  const missingFromJournal = sqlFiles.filter((tag) => !journalTags.has(tag));
  const missingFromDisk = journal.entries
    .map((e) => e.tag)
    .filter((tag) => !sqlFileSet.has(tag));

  if (missingFromJournal.length === 0 && missingFromDisk.length === 0) {
    console.log(
      `[migrations] OK — ${sqlFiles.length} SQL file(s) match journal entries`
    );
    return;
  }

  if (missingFromJournal.length > 0) {
    console.error(
      "[migrations] ERROR: SQL files exist on disk but are NOT in _journal.json:"
    );
    for (const tag of missingFromJournal) {
      console.error(`  - ${tag}.sql`);
    }
  }

  if (missingFromDisk.length > 0) {
    console.error(
      "[migrations] ERROR: Journal entries exist with no matching SQL file on disk:"
    );
    for (const tag of missingFromDisk) {
      console.error(`  - ${tag}`);
    }
  }

  console.error(
    "[migrations] FATAL: Migration journal is out of sync. Fix _journal.json before starting the server."
  );
  process.exit(1);
}
