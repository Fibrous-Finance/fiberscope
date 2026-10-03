import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";

const TIMEOUT_MS = 30 * 60_000;

/**
 * Downloads a database to `path`, which must not exist yet: how the indexer moves to a new host
 * without indexing everything again. The download goes to a temporary file that takes the path
 * only after it passes SQLite's integrity check. Returns the size in bytes.
 */
export async function seedDatabase(url: string, path: string): Promise<number> {
	if (existsSync(path)) {
		throw new Error(`${path} already exists; seed only creates a missing database`);
	}
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.seed`;
	try {
		const response = await get(url);
		if (response.statusCode !== 200) {
			response.resume();
			throw new Error(`the seed URL answered ${response.statusCode}`);
		}
		const file = createWriteStream(temporary);
		await pipeline(response, file, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		const db = new DatabaseSync(temporary, { readOnly: true });
		try {
			const check = db.prepare("PRAGMA quick_check").get();
			if (check?.quick_check !== "ok") {
				throw new Error(`the downloaded database failed its integrity check`);
			}
		} finally {
			db.close();
			removeSideFiles(temporary);
		}
		renameSync(temporary, path);
		return file.bytesWritten;
	} catch (error) {
		rmSync(temporary, { force: true });
		removeSideFiles(temporary);
		throw error;
	}
}

/**
 * A GET with Node's own HTTP client. Not fetch: streaming a large body through fetch crashed the
 * process with an undici assertion when the server closed the connection while it was paused.
 */
function get(url: string): Promise<IncomingMessage> {
	const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
	const client = new URL(url).protocol === "https:" ? httpsGet : httpGet;
	client(url, resolve).on("error", reject);
	return promise;
}

/** Opening a WAL-mode database, even read-only, leaves its (here empty) -wal and -shm files. */
function removeSideFiles(database: string): void {
	for (const suffix of ["-wal", "-shm"]) rmSync(database + suffix, { force: true });
}
