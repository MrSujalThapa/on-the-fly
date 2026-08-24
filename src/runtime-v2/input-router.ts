export type InputMode = "edit" | "interact";

export interface NormalizedPointer {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
}

export interface InputRouterHandlers {
  onPointerDown(event: NormalizedPointer): void;
  onPointerMove(event: NormalizedPointer): void;
  onPointerUp(event: NormalizedPointer): void;
  onPointerCancel(): void;
  onKeyDown(event: KeyboardEvent): void;
  onModeChange(mode: InputMode): void;
}

/**
 * Browser-vs-editor input ownership. Does not select visual units, resolve
 * identity, move DOM, save, or render overlays.
 */
export interface InputRouter {
  setMode(mode: InputMode): void;
  getMode(): InputMode;
  start(handlers: InputRouterHandlers): void;
  stop(): void;
}
