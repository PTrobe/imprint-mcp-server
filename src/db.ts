import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

/**
 * Open Imprint's SQLite database in read-only mode.
 *
 * Imprint stores its DB at `~/Library/Application Support/Imprint/imprint.db`.
 * Read-only access is critical: Imprint runs concurrently and writes; better-sqlite3
 * with `readonly: true` ensures we can't accidentally corrupt user data.
 */
export function openImprintDB(): Database.Database {
  const path = customPath() ?? defaultPath();
  if (!existsSync(path)) {
    throw new Error(
      `Imprint database not found at ${path}. ` +
        `Open Imprint at least once to initialize it, or set IMPRINT_DB_PATH.`,
    );
  }
  // `fileMustExist: true` + `readonly: true` = safest combo for a sidecar
  // process reading another app's primary DB. WAL mode (which GRDB enables
  // by default for Imprint) lets readers and writers coexist without locks.
  return new Database(path, { readonly: true, fileMustExist: true });
}

function defaultPath(): string {
  return join(homedir(), "Library", "Application Support", "Imprint", "imprint.db");
}

function customPath(): string | undefined {
  return process.env.IMPRINT_DB_PATH;
}
