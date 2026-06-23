export function modelSupportsTemperature(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  if (normalized.startsWith("gpt-5")) {
    return false;
  }
  if (normalized.startsWith("o1") || normalized.startsWith("o3") || normalized.startsWith("o4")) {
    return false;
  }
  return true;
}

export function resolveOpenAiTemperature(
  modelName: string,
  repairErrors: boolean | undefined,
): number | undefined {
  if (!modelSupportsTemperature(modelName)) {
    return undefined;
  }
  return repairErrors ? 0.2 : 0.4;
}

export function isUnsupportedProviderParameterError(message: string): boolean {
  return /unsupported (parameter|value)|temperature|not supported with/i.test(message);
}
