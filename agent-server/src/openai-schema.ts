import { HELPER_OBJECT_ROLES } from "../../src/editor/helper-object-contract.js";

const AGENT_OPERATION_TYPES = [
  "style",
  "move",
  "resize",
  "rotate",
  "zIndex",
  "hide",
  "insertHelperObject",
] as const;

const GENERIC_AGENT_OPERATION_TYPES = [
  "style",
  "move",
  "resize",
  "rotate",
  "zIndex",
  "hide",
] as const;

const SIGNATURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cssPath: { type: "string" },
    tagName: { type: "string" },
    classList: {
      type: "array",
      items: { type: "string" },
    },
    idAttr: { type: "string" },
  },
  required: ["cssPath", "tagName", "classList"],
} as const;

const RECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
  required: ["x", "y", "width", "height"],
} as const;

const HELPER_FILL_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["solid"] },
        color: { type: "string" },
      },
      required: ["type", "color"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["linearGradient"] },
        angleDeg: { type: "number" },
        stops: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              color: { type: "string" },
              position: { type: "number" },
            },
            required: ["color", "position"],
          },
        },
      },
      required: ["type", "angleDeg", "stops"],
    },
  ],
} as const;

const INSERT_HELPER_OBJECT_PAYLOAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    helperId: { type: "string" },
    role: { type: "string", enum: [...HELPER_OBJECT_ROLES] },
    rect: RECT_SCHEMA,
    fill: HELPER_FILL_SCHEMA,
    borderRadius: { type: "string" },
    opacity: { type: "number" },
    zIndex: { type: "integer" },
    label: { type: "string" },
    border: {
      type: "object",
      additionalProperties: false,
      properties: {
        width: { type: "number" },
        color: { type: "string" },
        style: { type: "string", enum: ["solid", "dashed", "dotted"] },
      },
      required: ["width", "color", "style"],
    },
    boxShadow: {
      type: "object",
      additionalProperties: false,
      properties: {
        offsetX: { type: "number" },
        offsetY: { type: "number" },
        blurRadius: { type: "number" },
        spreadRadius: { type: "number" },
        color: { type: "string" },
      },
      required: ["offsetX", "offsetY", "blurRadius", "color"],
    },
  },
  required: ["helperId", "role", "rect", "fill"],
} as const;

const INSERT_HELPER_OBJECT_OPERATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: ["insertHelperObject"] },
    pageKey: { type: "string" },
    target: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodeId: { type: "string" },
        groupId: { type: "string" },
        signature: SIGNATURE_SCHEMA,
      },
      required: ["nodeId", "signature"],
    },
    payload: INSERT_HELPER_OBJECT_PAYLOAD_SCHEMA,
    createdAt: { type: "number" },
    source: { type: "string", enum: ["agent"] },
    status: { type: "string", enum: ["draft", "preview"] },
  },
  required: ["id", "type", "target", "payload", "source", "status"],
} as const;

const GENERIC_AGENT_OPERATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: [...GENERIC_AGENT_OPERATION_TYPES] },
    pageKey: { type: "string" },
    target: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodeId: { type: "string" },
        groupId: { type: "string" },
        signature: SIGNATURE_SCHEMA,
      },
      required: ["nodeId"],
    },
    payload: { type: "object", additionalProperties: true },
    createdAt: { type: "number" },
    source: { type: "string", enum: ["agent"] },
    status: { type: "string", enum: ["draft", "preview"] },
  },
  required: ["id", "type", "target", "payload", "source", "status"],
} as const;

/** JSON schema passed to OpenAI structured output for agent edit responses. */
export const AGENT_EDIT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    draftOperations: {
      type: "array",
      maxItems: 12,
      items: {
        oneOf: [INSERT_HELPER_OBJECT_OPERATION_SCHEMA, GENERIC_AGENT_OPERATION_SCHEMA],
      },
    },
    summary: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
  },
  required: ["draftOperations", "summary", "warnings", "confidence"],
} as const;

export { AGENT_OPERATION_TYPES, HELPER_OBJECT_ROLES };
