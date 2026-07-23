import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The real per-user store lives directly under ~/.sylph. Scratch/worktree
// subdirectories and temp dirs are legitimate targets under test.
const REAL_SYLPH_DIR = path.join(os.homedir(), ".sylph");
function isRealSylphStore(filePath: string) {
  return path.dirname(path.resolve(filePath)) === REAL_SYLPH_DIR;
}

export interface JsonFileStoreOptions<T> {
  filePath: string;
  defaultValue: () => T;
  normalize: (value: unknown) => T;
  /** Unix mode used for both the directory and stored file where supported. */
  directoryMode?: number;
  fileMode?: number;
}

/**
 * Small synchronous JSON repository primitive for Sylph's local metadata.
 * Reads never mutate disk; writes use a same-directory temporary file and
 * rename so a crash cannot leave a half-written store behind.
 */
export class JsonFileStore<T> {
  private readonly options: JsonFileStoreOptions<T>;

  constructor(options: JsonFileStoreOptions<T>) {
    this.options = options;
  }

  read(): T {
    try {
      return this.options.normalize(JSON.parse(fs.readFileSync(this.options.filePath, "utf8")));
    } catch {
      return this.options.defaultValue();
    }
  }

  write(value: T): void {
    // Fail loudly rather than clobber real user data if a test forgets to mock
    // the Sylph config paths. Vitest sets VITEST in every worker.
    if (process.env.VITEST && isRealSylphStore(this.options.filePath)) {
      throw new Error(`Refusing to write the real Sylph store under test: ${this.options.filePath}. Mock server/config.ts paths.`);
    }
    const directory = path.dirname(this.options.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: this.options.directoryMode ?? 0o700 });
    const temporary = `${this.options.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(this.options.normalize(value), null, 2)}\n`, {
        encoding: "utf8",
        mode: this.options.fileMode ?? 0o600,
      });
      fs.renameSync(temporary, this.options.filePath);
      try { fs.chmodSync(this.options.filePath, this.options.fileMode ?? 0o600); } catch { /* non-Unix filesystem */ }
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort cleanup */ }
    }
  }
}
