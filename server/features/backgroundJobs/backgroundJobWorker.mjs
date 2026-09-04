import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const specPath = process.argv[2];
let spec;
try {
  spec = JSON.parse(readFileSync(specPath, "utf8"));
} catch (error) {
  console.error(`Could not read background job spec: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function atomicJsonWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

function outputSize() {
  try { return statSync(spec.outputPath).size; } catch { return 0; }
}

const outputFd = openSync(spec.outputPath, "a", 0o600);
const marker = (text) => {
  try { writeSync(outputFd, `\n--- ${text} ${new Date().toISOString()} ---\n`); } catch { /* result metadata still records failure */ }
};

let child;
let requestedStatus;
let requestedError;
let forceTimer;
let timeoutTimer;
let outputTimer;
let finalized = false;

function killChildTree(force = false) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const args = ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])];
    spawnSync("taskkill.exe", args, { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
  catch {
    try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* process already exited */ }
  }
}

function requestTermination(status, error) {
  if (!requestedStatus) {
    requestedStatus = status;
    requestedError = error;
    marker(error);
  }
  killChildTree(false);
  if (!forceTimer) {
    forceTimer = setTimeout(() => killChildTree(true), 2_000);
    forceTimer.unref();
  }
}

process.on("SIGTERM", () => requestTermination("killed", "background job was stopped"));
process.on("SIGINT", () => requestTermination("killed", "background job was interrupted"));

function finish(status, exitCode, signal, error) {
  if (finalized) return;
  finalized = true;
  if (forceTimer) clearTimeout(forceTimer);
  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (outputTimer) clearInterval(outputTimer);
  marker(`exit code=${exitCode ?? "null"} signal=${signal ?? "null"}`);
  try { closeSync(outputFd); } catch { /* best effort */ }
  const result = {
    status,
    endedAt: new Date().toISOString(),
    childPid: child?.pid,
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    signal: typeof signal === "string" ? signal : null,
    ...(error ? { error } : {}),
    outputBytes: outputSize(),
  };
  try {
    atomicJsonWrite(spec.resultPath, result);
  } catch (writeError) {
    console.error(`Could not persist background job result: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
    process.exit(1);
  }
  process.exit(status === "completed" ? 0 : 1);
}

try {
  marker("background job started");
  child = spawn(spec.shell, [...spec.shellArgs, spec.command], {
    cwd: spec.cwd,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["ignore", outputFd, outputFd],
    windowsHide: true,
  });
  atomicJsonWrite(spec.runtimePath, { childPid: child.pid });
  child.on("error", (error) => finish("failed", null, null, `Could not start command: ${error.message}`));
  child.on("close", (code, signal) => {
    const exceededOutput = outputSize() > spec.maxOutputBytes;
    const status = requestedStatus ?? (exceededOutput ? "failed" : (code ?? 1) === 0 ? "completed" : "failed");
    const error = requestedError
      ?? (exceededOutput ? `Output exceeded ${spec.maxOutputBytes} bytes` : undefined)
      ?? (status === "failed" ? `Command exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}` : undefined);
    finish(status, code, signal, error);
  });

  if (requestedStatus) requestTermination(requestedStatus, requestedError);
  if (Number.isFinite(spec.timeoutSeconds) && spec.timeoutSeconds > 0) {
    timeoutTimer = setTimeout(() => requestTermination("failed", `Timed out after ${Math.floor(spec.timeoutSeconds)}s`), Math.floor(spec.timeoutSeconds * 1000));
    timeoutTimer.unref();
  }
  outputTimer = setInterval(() => {
    const bytes = outputSize();
    if (bytes > spec.maxOutputBytes) requestTermination("failed", `Output exceeded ${spec.maxOutputBytes} bytes`);
  }, 500);
  outputTimer.unref();
} catch (error) {
  finish("failed", null, null, `Could not start background job: ${error instanceof Error ? error.message : String(error)}`);
}
