const ROOT_HOST_ID = "on-the-fly-root-host";

export class EditorShell {
  private rootHost: HTMLElement | null = null;
  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;
  private onDeactivate: (() => void) | null = null;

  isMounted(): boolean {
    return this.rootHost !== null;
  }

  mount(onDeactivate: () => void): void {
    if (this.rootHost) {
      return;
    }

    this.onDeactivate = onDeactivate;

    const host = document.createElement("div");
    host.id = ROOT_HOST_ID;
    host.setAttribute("data-on-the-fly", "root-host");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "pointer-events: none",
      "contain: strict",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.append(createShellStyles(), createActiveIndicator());

    document.documentElement.appendChild(host);
    this.rootHost = host;
    this.attachEscapeHandler();
  }

  unmount(): void {
    this.detachEscapeHandler();
    this.rootHost?.remove();
    this.rootHost = null;
    this.onDeactivate = null;
  }

  private attachEscapeHandler(): void {
    if (this.escapeHandler) {
      return;
    }

    this.escapeHandler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !this.isMounted()) {
        return;
      }

      event.preventDefault();
      this.onDeactivate?.();
    };

    window.addEventListener("keydown", this.escapeHandler, true);
  }

  private detachEscapeHandler(): void {
    if (!this.escapeHandler) {
      return;
    }

    window.removeEventListener("keydown", this.escapeHandler, true);
    this.escapeHandler = null;
  }
}

function createShellStyles(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    .otf-indicator {
      position: fixed;
      right: 16px;
      bottom: 16px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.92);
      color: #f9fafb;
      font: 600 12px/1 system-ui, -apple-system, sans-serif;
      letter-spacing: 0.01em;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      pointer-events: none;
      user-select: none;
    }

    .otf-indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #34d399;
      box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.25);
      flex: 0 0 auto;
    }
  `;
  return style;
}

function createActiveIndicator(): HTMLElement {
  const indicator = document.createElement("div");
  indicator.className = "otf-indicator";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  indicator.innerHTML = `<span class="otf-indicator-dot" aria-hidden="true"></span><span>On the Fly active</span>`;
  return indicator;
}
