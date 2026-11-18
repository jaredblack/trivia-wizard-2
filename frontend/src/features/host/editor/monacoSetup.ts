// One-time Monaco configuration for the deck editor: workers, the paper theme
// and YAML validation against the generated deck schema. Importing this module
// is what performs the setup; Monaco keeps module-level state, so it must run
// exactly once.

import * as monaco from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import YamlWorker from "../yaml.worker?worker";
import { buildDeckSchema } from "../../../deck/schema";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "yaml") return new YamlWorker();
    return new EditorWorker();
  },
};

// Transparent background (the container's paper colour shows through) with
// warm, inky token colours.
monaco.editor.defineTheme("trivia-paper", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8b7355", fontStyle: "italic" },
    { token: "type", foreground: "5b3a1d", fontStyle: "bold" },
    { token: "key", foreground: "5b3a1d", fontStyle: "bold" },
    { token: "string", foreground: "3a2f25" },
    { token: "number", foreground: "6b1c1c" },
    { token: "keyword", foreground: "6b1c1c" },
    { token: "delimiter", foreground: "8b7355" },
    { token: "tag", foreground: "5b3a1d" },
  ],
  colors: {
    "editor.background": "#00000000",
    "editor.foreground": "#3a2f25",
    "editorLineNumber.foreground": "#8b7355",
    "editorLineNumber.activeForeground": "#5b3a1d",
    "editorCursor.foreground": "#6b1c1c",
    "editor.selectionBackground": "#6b1c1c2e",
    "editor.inactiveSelectionBackground": "#6b1c1c1a",
    "editor.lineHighlightBackground": "#6b1c1c0d",
    "editor.lineHighlightBorder": "#00000000",
    "editorIndentGuide.background": "#8b735533",
    "editorIndentGuide.activeBackground": "#8b735566",
    "editorWhitespace.foreground": "#8b735533",
  },
});

configureMonacoYaml(monaco, {
  enableSchemaRequest: false,
  hover: true,
  completion: true,
  validate: true,
  format: { enable: false },
  schemas: [
    {
      fileMatch: ["*"],
      uri: "https://trivia-wizard.local/deck-schema.json",
      schema: buildDeckSchema(),
    },
  ],
});

export { monaco };
