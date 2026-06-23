import { describe, expect, it } from "vitest";
import { validateOperationForDom } from "../../src/editor/validation/validate-dom-operation.js";
import { createStyleOperation } from "../editor/fixtures.js";
import {
  buildBoxShadowValue,
  buildGradientFromPreset,
  buildLinearGradientValue,
  GRADIENT_PRESETS,
  parseLinearGradientValue,
} from "../../src/content/style-panel-controls.js";

describe("style panel controls", () => {
  it("builds a valid gradient operation payload from palette controls", () => {
    const preset = GRADIENT_PRESETS[0];
    if (!preset) {
      throw new Error("expected gradient preset");
    }

    const value = buildGradientFromPreset(preset);
    expect(parseLinearGradientValue(value)).not.toBeNull();

    const operation = createStyleOperation({
      payload: { property: "backgroundImage", value },
    });
    expect(validateOperationForDom(operation).ok).toBe(true);
  });

  it("builds a valid shadow operation payload from preset controls", () => {
    const value = buildBoxShadowValue("medium", 1.2);
    const operation = createStyleOperation({
      payload: { property: "boxShadow", value },
    });
    expect(validateOperationForDom(operation).ok).toBe(true);
  });

  it("rejects unsafe gradient colors", () => {
    expect(buildLinearGradientValue("red;}", "#ffffff", 90)).toBeNull();
  });
});
