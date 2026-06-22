import { PageCustomizationController } from "../../src/content/page-customization-controller.js";

export function createTestPageCustomization(document: Document): PageCustomizationController {
  return new PageCustomizationController(document);
}
