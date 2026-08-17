export class DisposableOwner {
  private readonly disposers: Array<() => void> = [];
  private disposed = false;

  add(dispose: () => void): void {
    if (this.disposed) {
      dispose();
      return;
    }
    this.disposers.push(dispose);
  }

  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  observe(observer: { disconnect: () => void }): void {
    this.add(() => {
      observer.disconnect();
    });
  }

  dispose(): void {
    this.disposed = true;
    while (this.disposers.length > 0) {
      const dispose = this.disposers.pop();
      dispose?.();
    }
  }

  get activeCount(): number {
    return this.disposers.length;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
