import { createEmptySelection, type EditorSelection } from "./editor-selection.js";
import type { ElementSignature } from "./element-signature.js";
import type { GroupId, PageKey, VisualNodeId } from "./ids.js";
import type { EditorOperation } from "./operations.js";

export interface GroupState {
  groupId: GroupId;
  memberNodeIds: VisualNodeId[];
  memberSignatures: ElementSignature[];
}

export interface EditorState {
  pageKey: PageKey;
  approvedOperations: EditorOperation[];
  draftOperations: EditorOperation[];
  previewOperations: EditorOperation[];
  groups: Record<GroupId, GroupState>;
  selection: EditorSelection;
  version: number;
}

export function createInitialEditorState(pageKey: PageKey): EditorState {
  return {
    pageKey,
    approvedOperations: [],
    draftOperations: [],
    previewOperations: [],
    groups: {},
    selection: createEmptySelection(),
    version: 0,
  };
}

export function cloneEditorState(state: EditorState): EditorState {
  return {
    pageKey: state.pageKey,
    approvedOperations: [...state.approvedOperations],
    draftOperations: [...state.draftOperations],
    previewOperations: [...state.previewOperations],
    groups: { ...state.groups },
    selection: {
      ...state.selection,
      selectedNodeIds: [...state.selection.selectedNodeIds],
    },
    version: state.version,
  };
}
