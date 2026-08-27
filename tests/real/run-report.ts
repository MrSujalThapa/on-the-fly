import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REAL_ARTIFACT_DIR, REAL_PROFILE_DIR } from "./constants.js";

export interface RealRunMeta {
  runId: string;
  startedAt: string;
  branch: string;
  commit: string;
  profile: string;
  sessionId: string;
  caseRange: string;
}

export function beginRealRun(input: {
  commit: string;
  branch: string;
  caseRange: string;
  sessionId?: string;
}): RealRunMeta {
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replaceAll(":", "").replaceAll(".", "");
  const runId = `${stamp}-${input.commit.slice(0, 7)}`;
  const meta: RealRunMeta = {
    runId,
    startedAt,
    branch: input.branch,
    commit: input.commit,
    profile: REAL_PROFILE_DIR,
    sessionId: input.sessionId ?? `playwright-real-${stamp}`,
    caseRange: input.caseRange,
  };
  const dir = join(REAL_ARTIFACT_DIR, "runs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${runId}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(join(dir, "CURRENT.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}
