import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { monaco } from "./editor/monacoSetup";
import "./editor.css";
import {
  ConflictError,
  eventImageUrls,
  getYaml,
  listEventImages,
  putYaml,
  uploadEventImage,
} from "../../services/eventsApi";
import { compileDeck, slideIndexAtLine } from "../../deck/compile";
import { convertLegacyDeck } from "../../deck/legacy";
import { addToList, setKey, type EditTarget, type LineEdit } from "../../deck/edit";
import { questionBadge } from "../../deck/summary";
import Inspector from "./editor/Inspector";
import { applyLineEdit } from "./editor/applyLineEdit";
import { compressImage, imageFromTransfer, newImageName } from "./editor/imageUpload";
import {
  knownImageNames,
  resolveImage,
  type ImageContext,
} from "../../deck/images";
import type { CompiledDeck } from "../../deck/types";
import { CDN_BASE, eventBaseFor, loadImageContext } from "../../presentation/loadDeck";

const SAVE_DEBOUNCE_MS = 1500;
const COMPILE_DEBOUNCE_MS = 150;

type Notice = { kind: "busy" | "info" | "error"; text: string };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

const absoluteUrl = (url: string) => new URL(url, window.location.origin).href;

// True when `lineNumber` is a list entry directly under `image:` or
// `answer-image:` — used to offer image names inside a block list.
function isUnderImageKey(model: monaco.editor.ITextModel, lineNumber: number): boolean {
  const indentOf = (line: string) => line.match(/^\s*/)![0].length;
  const entryIndent = indentOf(model.getLineContent(lineNumber));
  for (let n = lineNumber - 1; n >= 1; n--) {
    const line = model.getLineContent(n);
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const key = line.match(/^(\s*)(-\s+)?(image|answer-image):\s*(#.*)?$/);
    if (key) {
      // The key's own column: past the "- " when it sits on a slide's first line.
      const keyIndent = key[1].length + (key[2]?.length ?? 0);
      return entryIndent >= keyIndent;
    }
    // Earlier entries of the same list are skipped; anything else ends it.
    if (/^\s*-\s/.test(line) && indentOf(line) === entryIndent) continue;
    return false;
  }
  return false;
}

export default function EventEditor() {
  const { uuid } = useParams<{ uuid: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const etagRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const failedRef = useRef(false);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read by Monaco providers and decorations, which outlive any one render.
  const deckRef = useRef<CompiledDeck | null>(null);
  const imageCtxRef = useRef<ImageContext | null>(null);
  const recompileRef = useRef<() => void>(() => {});
  const attachImageRef = useRef<(file: File, line: number) => void>(() => {});

  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [deck, setDeck] = useState<CompiledDeck | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [imageCtx, setImageCtx] = useState<ImageContext | null>(null);

  const isUnsaved = () =>
    savingRef.current ||
    saveTimerRef.current !== null ||
    conflictRef.current ||
    failedRef.current;

  const save = useCallback(async () => {
    saveTimerRef.current = null;
    if (!uuid || conflictRef.current) return;
    const editor = editorRef.current;
    const etag = etagRef.current;
    if (!editor || !etag) return;

    const text = editor.getValue();
    savingRef.current = true;
    setSaveState({ kind: "saving" });
    try {
      const { etag: nextEtag } = await putYaml(uuid, text, etag);
      etagRef.current = nextEtag;
      failedRef.current = false;
      editor.updateOptions({ readOnly: false });
      setSaveState({ kind: "saved" });
      // Edits made while the request was in flight still need saving.
      if (editor.getValue() !== text && saveTimerRef.current === null) {
        saveTimerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);
      }
    } catch (e) {
      if (e instanceof ConflictError) {
        conflictRef.current = true;
        editor.updateOptions({ readOnly: true });
        setSaveState({ kind: "conflict" });
        return;
      }
      console.error("[editor] save failed:", e);
      // Stop accepting edits until a save goes through, so nothing is typed
      // into a document that isn't being stored.
      failedRef.current = true;
      editor.updateOptions({ readOnly: true });
      setSaveState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      savingRef.current = false;
    }
  }, [uuid]);

  // Load the YAML and image lists, mount Monaco and register providers.
  useEffect(() => {
    if (!uuid || !containerRef.current) return;
    let cancelled = false;
    const disposables: { dispose: () => void }[] = [];
    let compileTimer: ReturnType<typeof setTimeout> | null = null;
    let thumbs: monaco.editor.IEditorDecorationsCollection | null = null;
    const thumbUrlByClass = new Map<string, string>();

    // Monaco's hover provider doesn't fire on the line-decoration lane, so the
    // larger preview for gutter thumbnails is a plain DOM tooltip.
    const thumbTooltip = document.createElement("div");
    thumbTooltip.id = "thumb-tooltip";
    const thumbTooltipImg = document.createElement("img");
    thumbTooltip.appendChild(thumbTooltipImg);
    document.body.appendChild(thumbTooltip);

    const thumbClass = (url: string) => {
      const cls = "img-thumb-" + url.replace(/[^a-z0-9]/gi, "_");
      if (!thumbUrlByClass.has(cls)) {
        thumbUrlByClass.set(cls, url);
        const style = document.createElement("style");
        style.textContent = `.${cls} { background-image: url("${url}"); }`;
        document.head.appendChild(style);
        disposables.push({ dispose: () => style.remove() });
      }
      return cls;
    };

    const questionNumberAtLine = new Map<number, number>();
    // A fresh closure each time: Monaco skips re-rendering the gutter when the
    // lineNumbers function reference is unchanged.
    const lineNumberRenderer = (): monaco.editor.LineNumbersType => (n: number) => {
      const num = questionNumberAtLine.get(n);
      return num === undefined ? "" : String(num);
    };

    const refreshDecorations = () => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const current = deckRef.current;
      if (!editor || !model || !current) return;

      questionNumberAtLine.clear();
      const decos: monaco.editor.IModelDeltaDecoration[] = [];
      const markers: monaco.editor.IMarkerData[] = [];

      // Positions in a legacy deck describe the converted text, not what is in
      // the editor, so nothing is drawn until it has been converted.
      if (!current.legacy) {
        const lineCount = model.getLineCount();
        for (const q of current.questions) {
          const line = q.range.startLine;
          questionNumberAtLine.set(line, q.number);
          // Only questions that differ from the deck's defaults get a note,
          // so the exceptions stand out when scrolling.
          const badge = questionBadge(q, current);
          if (badge && line <= lineCount) {
            const eol = model.getLineMaxColumn(line);
            decos.push({
              range: new monaco.Range(line, eol, line, eol),
              options: {
                after: { content: badge, inlineClassName: "q-badge" },
                showIfCollapsed: true,
              },
            });
          }
        }
        const ctx = imageCtxRef.current;
        const thumbed = new Set<number>();
        for (const img of current.images) {
          if (img.line > lineCount) continue;
          const resolved = ctx ? resolveImage(img.ref, ctx) : null;
          if (resolved?.found) {
            if (thumbed.has(img.line)) continue;
            thumbed.add(img.line);
            decos.push({
              range: new monaco.Range(img.line, 1, img.line, 1),
              options: {
                linesDecorationsClassName: `img-thumb ${thumbClass(resolved.url)}`,
              },
            });
          } else if (resolved) {
            markers.push({
              severity: monaco.MarkerSeverity.Warning,
              message: `No image called "${img.ref}" in this event or the shared images.`,
              startLineNumber: img.line,
              startColumn: img.col,
              endLineNumber: img.line,
              endColumn: img.endCol,
            });
          }
        }
        for (const p of current.problems) {
          const line = Math.min(Math.max(p.line ?? 1, 1), lineCount);
          markers.push({
            severity:
              p.severity === "error"
                ? monaco.MarkerSeverity.Error
                : monaco.MarkerSeverity.Warning,
            message: p.message,
            startLineNumber: line,
            startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
            endLineNumber: line,
            endColumn: model.getLineMaxColumn(line),
          });
        }
      }

      editor.updateOptions({ lineNumbers: lineNumberRenderer() });
      thumbs?.set(decos);
      monaco.editor.setModelMarkers(model, "deck", markers);
    };

    const recompile = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const next = compileDeck(editor.getValue());
      deckRef.current = next;
      setDeck(next);
      document.title = next.title ? `${next.title} · Editor` : "Deck editor";
      refreshDecorations();
    };
    recompileRef.current = recompile;

    (async () => {
      let initial: { text: string; etag: string };
      try {
        initial = await getYaml(uuid);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (cancelled) return;
      etagRef.current = initial.etag;

      // Image lists load alongside the editor; nothing waits on them. The
      // event's own images are listed from storage rather than the published
      // manifest so a fresh upload shows up immediately.
      const imagesP = Promise.all([
        loadImageContext(uuid),
        listEventImages(uuid).catch(() => null),
      ]).then(([ctx, listed]) => {
        imageCtxRef.current = {
          ...ctx,
          cdnBase: CDN_BASE,
          eventBase: eventBaseFor(uuid),
          eventImages: listed ?? ctx.eventImages,
        };
        if (!cancelled) setImageCtx(imageCtxRef.current);
      });

      const editor = monaco.editor.create(containerRef.current!, {
        value: initial.text,
        language: "yaml",
        theme: "trivia-paper",
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: '"Courier Prime", Menlo, Monaco, monospace',
        fontSize: 15,
        lineHeight: 24,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: "on",
        lineNumbers: lineNumberRenderer(),
        lineNumbersMinChars: 3,
        // Lane between line numbers and code for image thumbnails.
        lineDecorationsWidth: 56,
        renderLineHighlight: "line",
        // Pasted and dropped images are uploaded and attached below; Monaco's
        // own handling would insert a file path instead.
        dropIntoEditor: { enabled: false },
        pasteAs: { enabled: false },
      });
      editorRef.current = editor;
      thumbs = editor.createDecorationsCollection();

      recompile();
      imagesP.then(() => {
        if (!cancelled) refreshDecorations();
      });

      disposables.push(
        editor.onDidChangeModelContent(() => {
          if (!conflictRef.current && !failedRef.current) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);
          }
          if (compileTimer) clearTimeout(compileTimer);
          compileTimer = setTimeout(recompile, COMPILE_DEBOUNCE_MS);
        })
      );

      // Hovering an image name previews it.
      disposables.push(
        monaco.languages.registerHoverProvider("yaml", {
          provideHover(model, position) {
            if (model !== editor.getModel()) return null;
            const current = deckRef.current;
            const ctx = imageCtxRef.current;
            if (!current || current.legacy || !ctx) return null;
            const hit = current.images.find(
              (i) =>
                i.line === position.lineNumber &&
                position.column >= i.col &&
                position.column <= i.endCol
            );
            if (!hit) return null;
            const resolved = resolveImage(hit.ref, ctx);
            return {
              range: new monaco.Range(hit.line, hit.col, hit.line, hit.endCol),
              contents: [
                {
                  value: resolved.found
                    ? `![${hit.ref}](${absoluteUrl(resolved.url)})`
                    : `No image called \`${hit.ref}\` in this event or the shared images.`,
                },
              ],
            };
          },
        })
      );

      // Offer known image names after `image:` / `answer-image:`.
      disposables.push(
        monaco.languages.registerCompletionItemProvider("yaml", {
          triggerCharacters: [" ", "-"],
          provideCompletionItems(model, position) {
            const ctx = imageCtxRef.current;
            if (model !== editor.getModel() || !ctx) return { suggestions: [] };
            const upToCursor = model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            });
            let partial: string | null = null;
            const onKey = upToCursor.match(
              /^\s*(?:-\s+)?(?:image|answer-image):\s*['"]?([^\s'"#]*)$/
            );
            if (onKey) partial = onKey[1];
            else {
              const inList = upToCursor.match(/^\s*-\s+['"]?([^\s'"#]*)$/);
              if (inList && isUnderImageKey(model, position.lineNumber)) {
                partial = inList[1];
              }
            }
            if (partial === null) return { suggestions: [] };

            const range = new monaco.Range(
              position.lineNumber,
              position.column - partial.length,
              position.lineNumber,
              position.column
            );
            const suggestions = knownImageNames(ctx).map((name, i) => {
              const resolved = resolveImage(name, ctx);
              return {
                label: name,
                kind: monaco.languages.CompletionItemKind.File,
                insertText: name,
                range,
                detail:
                  resolved.found && resolved.scope === "event"
                    ? "this event"
                    : "shared image",
                sortText: String(i).padStart(4, "0"),
                documentation: resolved.found
                  ? { value: `![${name}](${absoluteUrl(resolved.url)})` }
                  : undefined,
              };
            });
            return { suggestions };
          },
        })
      );

      // Shift+Alt+Q: new question after the slide under the cursor.
      disposables.push(
        editor.addAction({
          id: "trivia.newQuestion",
          label: "Trivia: New question",
          keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyQ],
          run: (ed) => {
            const model = ed.getModel();
            const pos = ed.getPosition();
            if (!model || !pos) return;
            const current = deckRef.current;
            const idx =
              current && !current.legacy ? slideIndexAtLine(current, pos.lineNumber) : -1;
            const range = idx === -1 ? undefined : current!.slides[idx].range;
            const indent = range
              ? (model.getLineContent(range.startLine).match(/^\s*/)?.[0] ?? "")
              : "";

            const onBlank = /^\s*$/.test(model.getLineContent(pos.lineNumber));
            let insertLine: number;
            if (onBlank) {
              // Fill the blank line in place.
              insertLine = pos.lineNumber;
              ed.executeEdits("trivia.newQuestion", [
                {
                  range: new monaco.Range(
                    insertLine,
                    1,
                    insertLine,
                    model.getLineMaxColumn(insertLine)
                  ),
                  text: "",
                },
              ]);
            } else {
              // Open a line after the current slide so the new block never
              // lands in the middle of it.
              const anchor = range ? range.contentEndLine : pos.lineNumber;
              const eol = model.getLineMaxColumn(anchor);
              ed.executeEdits("trivia.newQuestion", [
                { range: new monaco.Range(anchor, eol, anchor, eol), text: "\n" },
              ]);
              insertLine = anchor + 1;
            }
            ed.setPosition({ lineNumber: insertLine, column: 1 });
            const snippet =
              `${indent}- q: \${1:question text}\n` + `${indent}  a: \${2:answer text}`;
            const snippetController = ed.getContribution("snippetController2") as {
              insert(s: string): void;
            } | null;
            snippetController?.insert(snippet);
          },
        })
      );

      // Upload an image and attach it to the slide on `line`.
      const attachImage = async (file: File, line: number) => {
        const current = deckRef.current;
        if (!current || current.legacy) {
          setNotice({ kind: "info", text: "Convert this deck before adding images." });
          return;
        }
        const idx = slideIndexAtLine(current, line);
        const slide = idx === -1 ? null : current.slides[idx];
        if (
          !slide ||
          slide.itemIndex === undefined ||
          slide.type === "join" ||
          slide.type === "custom"
        ) {
          setNotice({
            kind: "info",
            text: "Put the cursor in a question, category or image slide, then paste again.",
          });
          return;
        }
        setNotice({ kind: "busy", text: "Uploading image…" });
        try {
          const blob = await compressImage(file);
          const ctx = imageCtxRef.current;
          const name = newImageName(ctx ? knownImageNames(ctx) : []);
          const filename = `${name}.jpg`;
          await uploadEventImage(uuid, filename, blob);
          if (cancelled) return;
          const urls = await eventImageUrls(uuid).catch(() => ({}));
          if (ctx) {
            imageCtxRef.current = {
              ...ctx,
              eventImages: [...ctx.eventImages, filename],
              eventImageUrls: urls,
            };
            setImageCtx(imageCtxRef.current);
          }

          // Address the slide by its place in the list: the text may have
          // changed while the upload was in flight.
          const target: EditTarget = { type: "slide", index: slide.itemIndex };
          const text = editor.getValue();
          const edit =
            slide.type === "image"
              ? setKey(text, target, "image", name)
              : addToList(text, target, "image", name);
          if (edit) {
            applyLineEdit(editor, edit, "trivia.image");
            setNotice({ kind: "info", text: `Image added as ${name}.` });
          } else {
            setNotice({
              kind: "error",
              text: `Uploaded as ${name}, but it couldn't be added to the slide. Add "image: ${name}" yourself.`,
            });
          }
          recompile();
        } catch (e) {
          if (cancelled) return;
          console.error("[editor] image upload failed:", e);
          setNotice({
            kind: "error",
            text: `Couldn't add the image: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      };

      attachImageRef.current = (file, line) => void attachImage(file, line);
      disposables.push(
        editor.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber))
      );

      const container = containerRef.current!;

      // Capture phase, so an image paste never reaches Monaco's own handler.
      const onPaste = (e: ClipboardEvent) => {
        const file = imageFromTransfer(e.clipboardData, { preferText: true });
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        void attachImage(file, editor.getPosition()?.lineNumber ?? 1);
      };
      const hasFiles = (e: DragEvent) =>
        Array.from(e.dataTransfer?.types ?? []).includes("Files");
      const onDragOver = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      };
      const onDrop = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const file = imageFromTransfer(e.dataTransfer, { preferText: false });
        if (!file) {
          setNotice({ kind: "info", text: "Only image files can be dropped here." });
          return;
        }
        // Attach to the slide under the pointer, not wherever the cursor was.
        const at = editor.getTargetAtClientPoint(e.clientX, e.clientY)?.position;
        void attachImage(file, at?.lineNumber ?? editor.getPosition()?.lineNumber ?? 1);
      };
      container.addEventListener("paste", onPaste, true);
      container.addEventListener("dragover", onDragOver, true);
      container.addEventListener("drop", onDrop, true);
      disposables.push({
        dispose: () => {
          container.removeEventListener("paste", onPaste, true);
          container.removeEventListener("dragover", onDragOver, true);
          container.removeEventListener("drop", onDrop, true);
        },
      });

      // Larger preview on hovering a gutter thumbnail.
      const onMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target?.classList.contains("img-thumb")) return;
        let url: string | null = null;
        for (const cls of target.classList) {
          url = thumbUrlByClass.get(cls) ?? url;
        }
        if (!url) return;
        thumbTooltipImg.src = url;
        const rect = target.getBoundingClientRect();
        thumbTooltip.style.left = `${rect.right + 8}px`;
        thumbTooltip.style.top = `${rect.top}px`;
        thumbTooltip.style.display = "block";
      };
      const onMouseOut = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.classList.contains("img-thumb")) {
          thumbTooltip.style.display = "none";
        }
      };
      container.addEventListener("mouseover", onMouseOver);
      container.addEventListener("mouseout", onMouseOut);
      disposables.push({
        dispose: () => {
          container.removeEventListener("mouseover", onMouseOver);
          container.removeEventListener("mouseout", onMouseOut);
        },
      });

      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (compileTimer) clearTimeout(compileTimer);
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* ignore */
        }
      }
      thumbTooltip.remove();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [uuid, save]);

  // Warn on tab close / full reload while something is unsaved.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isUnsaved()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Passing notices clear themselves; errors stay until dismissed.
  useEffect(() => {
    if (notice?.kind !== "info") return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Inspector edits go through the editor so they are undoable and autosaved
  // like typing.
  const runEdit = useCallback((compute: (text: string) => LineEdit | null) => {
    const editor = editorRef.current;
    if (!editor || conflictRef.current || failedRef.current) return;
    const edit = compute(editor.getValue());
    if (!edit) return;
    applyLineEdit(editor, edit, "trivia.inspector");
    recompileRef.current();
  }, []);

  const attachFile = useCallback(
    (file: File, line: number) => attachImageRef.current(file, line),
    []
  );

  const jumpToLine = useCallback((line: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(line);
    editor.focus();
  }, []);

  const navigate = useNavigate();
  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    if (
      isUnsaved() &&
      !window.confirm("You have unsaved edits. Leave anyway? Your changes will be lost.")
    ) {
      return;
    }
    navigate("/host/events");
  };

  // Rewrite an old-format deck in place. One undoable edit; autosave follows.
  const handleConvert = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    try {
      const converted = convertLegacyDeck(editor.getValue());
      editor.pushUndoStop();
      editor.executeEdits("trivia.convert", [
        { range: model.getFullModelRange(), text: converted },
      ]);
      editor.pushUndoStop();
      setConvertError(null);
      recompileRef.current();
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="editor-paper h-screen flex flex-col">
      <header className="editor-header border-b">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-4 min-w-0">
            <a href="/host/events" onClick={handleBack} className="underline text-sm shrink-0">
              ← Events
            </a>
            <span className="text-sm text-gray-800 font-medium truncate">
              {deck?.title || "Untitled deck"}
            </span>
          </div>
          <SaveStatus state={saveState} />
        </div>
      </header>

      {saveState.kind === "error" && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm" role="alert">
          <div className="p-3 flex items-center justify-between gap-4">
            <span>
              Couldn't save: {saveState.message} Editing is paused so nothing is lost; your
              text is still here.
            </span>
            <button
              type="button"
              onClick={() =>
                // Hand the keyboard back so typing can carry straight on.
                void save().then(() => {
                  if (!failedRef.current) editorRef.current?.focus();
                })
              }
              className="shrink-0 px-3 py-1 rounded border border-red-300 bg-white hover:bg-red-100 cursor-pointer"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {saveState.kind === "conflict" && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm" role="alert">
          <div className="p-3">
            This deck was saved somewhere else since you opened it. Saving is paused. Copy
            any edits you want to keep, then reload.
          </div>
        </div>
      )}

      {loadError && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm" role="alert">
          <div className="p-3">Couldn't load this deck: {loadError}</div>
        </div>
      )}

      {notice && (
        <div
          className={`border-b text-sm ${
            notice.kind === "error"
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-stone-100 border-stone-200 text-stone-700"
          }`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <div className="px-3 py-2 flex items-center justify-between gap-4">
            <span>{notice.text}</span>
            {notice.kind !== "busy" && (
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 underline cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {deck?.legacy && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
          <div className="p-3 flex items-center justify-between gap-4">
            <span>
              This deck is in the old format. It still presents, but the editor's previews
              and checks need the new one.
              {convertError && <span className="text-red-700"> Couldn't convert: {convertError}</span>}
            </span>
            <button
              type="button"
              onClick={handleConvert}
              className="shrink-0 px-3 py-1 rounded border border-amber-300 bg-white hover:bg-amber-100 cursor-pointer"
            >
              Convert deck
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative min-w-0">
          {!ready && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-700">
              Loading…
            </div>
          )}
          <div ref={containerRef} className="absolute inset-0" data-testid="deck-editor" />
        </div>
        {!loadError && (
          <Inspector
            deck={deck}
            cursorLine={cursorLine}
            imageCtx={imageCtx}
            runEdit={runEdit}
            attachFile={attachFile}
            jumpToLine={jumpToLine}
          />
        )}
      </div>
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  switch (state.kind) {
    case "idle":
      return <span className="text-xs text-gray-500">No changes</span>;
    case "saving":
      return <span className="text-xs text-gray-600">Saving…</span>;
    case "saved":
      return <span className="text-xs text-green-700">Saved</span>;
    case "error":
      return <span className="text-xs text-red-700">Not saved</span>;
    case "conflict":
      return <span className="text-xs text-red-700">Not saved</span>;
  }
}
