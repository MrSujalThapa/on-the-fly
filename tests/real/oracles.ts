import type { Page, TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REAL_ARTIFACT_DIR } from "./constants.js";

export {
  captureOracle,
  captureStepSnapshot,
  dragHandle,
  parseStored,
  type VisualOracle,
} from "../e2e/helpers/visual-oracle.js";

export async function attachFailureArtifacts(
  page: Page,
  testInfo: TestInfo,
  caseId: string,
  step: number,
  before: unknown,
  after: unknown,
): Promise<void> {
  const dir = join(REAL_ARTIFACT_DIR, "diagnose", testInfo.testId);
  mkdirSync(dir, { recursive: true });
  const payload = { caseId, step, before, after, url: page.url() };
  const jsonPath = join(dir, `${caseId}-step${String(step)}.json`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  await testInfo.attach(`${caseId}-step${String(step)}-state`, {
    path: jsonPath,
    contentType: "application/json",
  });
  const afterShot = join(dir, `${caseId}-step${String(step)}-after.png`);
  await page.screenshot({ path: afterShot, fullPage: false });
  await testInfo.attach(`${caseId}-step${String(step)}-after`, { path: afterShot, contentType: "image/png" });
  await page.waitForTimeout(2000);
  const laterShot = join(dir, `${caseId}-step${String(step)}-2s.png`);
  await page.screenshot({ path: laterShot, fullPage: false });
  await testInfo.attach(`${caseId}-step${String(step)}-2s`, { path: laterShot, contentType: "image/png" });
}
