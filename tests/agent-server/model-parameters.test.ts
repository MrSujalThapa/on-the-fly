import { describe, expect, it } from "vitest";
import {
  isUnsupportedProviderParameterError,
  modelSupportsTemperature,
  resolveOpenAiTemperature,
} from "../../agent-server/src/model-parameters.js";

describe("model parameters", () => {
  it("omits temperature for GPT-5-mini", () => {
    expect(modelSupportsTemperature("gpt-5-mini")).toBe(false);
    expect(resolveOpenAiTemperature("gpt-5-mini", false)).toBeUndefined();
    expect(resolveOpenAiTemperature("gpt-5-mini", true)).toBeUndefined();
  });

  it("keeps temperature for GPT-4-family models", () => {
    expect(modelSupportsTemperature("gpt-4o-mini")).toBe(true);
    expect(resolveOpenAiTemperature("gpt-4o-mini", false)).toBe(0.4);
  });

  it("detects unsupported provider parameter errors", () => {
    expect(isUnsupportedProviderParameterError("Unsupported parameter: 'temperature'")).toBe(true);
    expect(isUnsupportedProviderParameterError("invalid json")).toBe(false);
  });
});
