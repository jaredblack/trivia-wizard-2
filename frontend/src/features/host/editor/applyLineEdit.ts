import type * as monaco from "monaco-editor";
import type { LineEdit } from "../../../deck/edit";

/**
 * Apply a whole-line edit to the editor as one undoable step. Going through
 * the editor (rather than replacing its text) keeps the cursor, the undo stack
 * and autosave working as if the author had typed it.
 */
export function applyLineEdit(
  editor: monaco.editor.IStandaloneCodeEditor,
  edit: LineEdit,
  source = "trivia.edit"
): void {
  const model = editor.getModel();
  if (!model) return;
  const lineCount = model.getLineCount();
  const eol = (line: number) => model.getLineMaxColumn(line);
  let range: monaco.IRange;
  let text: string;

  if (edit.endLine < edit.startLine) {
    // Insert before `startLine`.
    if (edit.startLine > lineCount) {
      range = { startLineNumber: lineCount, startColumn: eol(lineCount), endLineNumber: lineCount, endColumn: eol(lineCount) };
      text = "\n" + edit.lines.join("\n");
    } else {
      range = { startLineNumber: edit.startLine, startColumn: 1, endLineNumber: edit.startLine, endColumn: 1 };
      text = edit.lines.join("\n") + "\n";
    }
  } else if (edit.lines.length === 0) {
    // Delete whole lines, taking one line break with them.
    if (edit.endLine < lineCount) {
      range = { startLineNumber: edit.startLine, startColumn: 1, endLineNumber: edit.endLine + 1, endColumn: 1 };
    } else if (edit.startLine > 1) {
      range = { startLineNumber: edit.startLine - 1, startColumn: eol(edit.startLine - 1), endLineNumber: edit.endLine, endColumn: eol(edit.endLine) };
    } else {
      range = { startLineNumber: 1, startColumn: 1, endLineNumber: edit.endLine, endColumn: eol(edit.endLine) };
    }
    text = "";
  } else {
    range = { startLineNumber: edit.startLine, startColumn: 1, endLineNumber: edit.endLine, endColumn: eol(edit.endLine) };
    text = edit.lines.join("\n");
  }

  editor.pushUndoStop();
  editor.executeEdits(source, [{ range, text }]);
  editor.pushUndoStop();
}
