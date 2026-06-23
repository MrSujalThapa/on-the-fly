import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";

export type ManualToolIntent =
  | "text_color"
  | "background_color"
  | "font_size"
  | "move"
  | "resize"
  | "rotate"
  | "crop"
  | "hide"
  | "layer_order"
  | "opacity";

export interface ManualToolRecommendation {
  status: "manual_tool_recommended";
  matchedIntent: ManualToolIntent;
  summary: string[];
  warnings: string[];
}

type IntentRule = {
  intent: ManualToolIntent;
  pattern: RegExp;
  summary: string;
};

const AGENT_COMPOSITION_PATTERNS = [
  /\bmodern(?:ize|ised?)?\b/i,
  /\bpremium\b/i,
  /\belevated?\b/i,
  /\bhierarchy\b/i,
  /\bgradient\b/i,
  /\bshadow(?:\s+composition|\s+layer)?\b/i,
  /\bbackground\s+panel\b/i,
  /\bvisual\s+container\b/i,
  /\bdecorativ(?:e|ion)\b/i,
  /\bclean\s+up\s+spacing\b/i,
  /\bsoft\s+box\b/i,
  /\bcard\s+feel\b/i,
  /\bcomposition\b/i,
  /\bhelper\s+object\b/i,
  /\bspacing\s+and\s+hierarchy\b/i,
  /\bmake\s+this\s+(?:section|area|selection)\b/i,
];

const MANUAL_TOOL_RULES: IntentRule[] = [
  {
    intent: "text_color",
    pattern: /\b(text\s*color|font\s*color|make\s+(?:the\s+)?text\s+\w+|change\s+(?:the\s+)?text\s+color)\b/i,
    summary: "Use the style toolbar to change text color on the selected element.",
  },
  {
    intent: "background_color",
    pattern: /\b(background\s*color|bg\s*color|change\s+(?:the\s+)?background\s+color)\b/i,
    summary: "Use the style toolbar to change background color on the selected element.",
  },
  {
    intent: "font_size",
    pattern: /\b(font\s*size|font-size|make\s+(?:the\s+)?text\s+(?:bigger|smaller|larger))\b/i,
    summary: "Use the style toolbar to adjust font size on the selected element.",
  },
  {
    intent: "move",
    pattern: /\b(move|nudge|shift)\b/i,
    summary: "Use move handles or toolbar commands to reposition the selected element.",
  },
  {
    intent: "resize",
    pattern: /\b(resize|make\s+(?:it|this)\s+(?:bigger|smaller|wider|taller|narrower|shorter))\b/i,
    summary: "Use resize handles to change the selected element size.",
  },
  {
    intent: "rotate",
    pattern: /\brotate\b/i,
    summary: "Use rotate handles to rotate the selected element.",
  },
  {
    intent: "crop",
    pattern: /\bcrop\b/i,
    summary: "Use the crop command on the selected image or element.",
  },
  {
    intent: "hide",
    pattern: /\b(hide|unhide|show\s+again)\b/i,
    summary: "Use the hide/show command on the selected element.",
  },
  {
    intent: "layer_order",
    pattern: /\b(z-?index|layer\s+order|bring\s+to\s+front|send\s+to\s+back|move\s+(?:up|down)\s+a\s+layer)\b/i,
    summary: "Use layer order commands to change stacking on the selected element.",
  },
  {
    intent: "opacity",
    pattern: /\b(opacity|transparen(?:t|cy))\b/i,
    summary: "Use the opacity control in the style toolbar on the selected element.",
  },
];

export function classifyAgentInstruction(instruction: string): ManualToolRecommendation | null {
  const normalized = instruction.trim();
  if (!normalized) {
    return null;
  }

  if (AGENT_COMPOSITION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  for (const rule of MANUAL_TOOL_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        status: "manual_tool_recommended",
        matchedIntent: rule.intent,
        summary: [rule.summary, "The agent is for higher-level visual composition, not one-step toolbar edits."],
        warnings: [],
      };
    }
  }

  return null;
}

export function shouldRouteToManualTool(request: AgentEditRequest): ManualToolRecommendation | null {
  return classifyAgentInstruction(request.instruction);
}
