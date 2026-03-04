import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const dbPath: string = process.env.DATABASE_PATH || path.join(process.cwd(), 'db', 'database.sqlite');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);

export function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS committed_policies (
            roleId TEXT PRIMARY KEY,
            data TEXT
        );
        CREATE TABLE IF NOT EXISTS pending_policy_requests (
            id TEXT PRIMARY KEY,
            requestedBy TEXT,
            data TEXT
        );
        CREATE TABLE IF NOT EXISTS policy_request_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            policy_request_id TEXT NOT NULL,
            user_vuid TEXT NOT NULL,
            decision INTEGER,
            FOREIGN KEY (policy_request_id) REFERENCES pending_policy_requests(id) ON DELETE CASCADE,
            UNIQUE(policy_request_id, user_vuid)
        );
    `);
}

initializeDatabase();
