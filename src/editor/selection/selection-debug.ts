/** Set to `true` locally when investigating pointer/rectangle selection. */
export const SELECTION_POINTER_DEBUG = false;

export function logSelectionDebug(message: string, data?: unknown): void {
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- intentional dev toggle */
  if (!SELECTION_POINTER_DEBUG) {
    return;
  }
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  if (data === undefined) {
    console.debug(`[OTF selection] ${message}`);
    return;
  }

  console.debug(`[OTF selection] ${message}`, data);
}
