// Loaded before every test file (see the test script), so tests and the servers they start
// keep side data in a folder of their own instead of the user's.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.INPLACE_STATE_DIR ??= mkdtempSync(join(tmpdir(), "inplace-state-"));
