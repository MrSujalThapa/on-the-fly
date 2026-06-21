import { Window } from "happy-dom";

export interface TestDocumentContext {
  document: Document;
  root: HTMLElement;
}

export function createTestDocument(html: string): TestDocumentContext {
  const window = new Window({
    innerWidth: 1024,
    innerHeight: 768,
  });
  const document = window.document as unknown as Document;
  document.body.innerHTML = html;

  return {
    document,
    root: document.body,
  };
}
