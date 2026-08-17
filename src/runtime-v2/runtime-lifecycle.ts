export interface RuntimeLifecycle {
  start(): void;
  stop(): void;
  /** Host document is ready for resolve/replay. */
  onDocumentReady(): void;
  /** Host routed or replaced substantial DOM. */
  onDomInvalidated(): void;
}
