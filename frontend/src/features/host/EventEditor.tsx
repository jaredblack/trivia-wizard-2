import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as monaco from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import YamlWorker from "./yaml.worker?worker";
import schema from "./trivia-schema.json";
import "./editor.css";
import {
  ConflictError,
  getYaml,
  listEventImages,
  listEventUuids,
  putImagesManifest,
  putYaml,
} from "../../services/eventsApi";

// Wire Monaco's worker resolver once. Monaco maintains module-level state, so
// re-running this is harmless if the editor remounts.
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

// Custom theme that matches the parchment presentation: transparent
// background (so the container's paper texture shows through) with warm,
// inky token colors. Defined at module scope — Monaco dedupes by name.
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
  format: false,
  schemas: [
    {
      fileMatch: ["*"],
      uri: "https://trivia-wizard.local/trivia-schema.json",
      schema: schema as object,
    },
  ],
});

const SAVE_DEBOUNCE_MS = 1500;
const PARSE_DEBOUNCE_MS = 150;
const HAS_EVENT_LOCAL_REF = /^\s*(?:-\s+)?(?:url|image|file):\s*['"]?\.\//m;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

// ─── Pure helpers ──────────────────────────────────────────────────────────

function manifestToMap(files: string[]): Map<string, string> {
  return new Map(
    files.map((f) => [f.replace(/\.[^.]+$/, "").toLowerCase(), f])
  );
}

// Scan YAML text for `- type: question` blocks, find each block's `id:`,
// and assign sequential numbers. Repeat IDs share a number — mirrors the
// numbering in build.ts so the editor matches the rendered slides.
function buildQuestionLineMap(text: string): Map<number, number> {
  const lines = text.split("\n");
  const map = new Map<number, number>();
  const numByID = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s+type:\s*question\s*(#.*)?$/);
    if (!m) continue;
    const indent = m[1].length;
    let id: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
      const lm = line.match(/^(\s*)\S/);
      if (!lm) continue;
      if (lm[1].length <= indent) break;
      const fm = line.match(/^\s*id:\s*(['"]?)([^'"\s#]+)\1/);
      if (fm) {
        id = fm[2];
        break;
      }
    }
    if (!id) continue;
    const key = id.toLowerCase();
    let num = numByID.get(key);
    if (num === undefined) {
      num = numByID.size + 1;
      numByID.set(key, num);
    }
    map.set(i + 1, num);
  }
  return map;
}

interface ImageHit {
  ref: string;
  start: number;
  end: number;
}

// Identify the image reference (if any) on a given line.
//   url: <ref>            (canonical, inside images: arrays)
//   image: <ref>          (image-slide top-level field)
//   - <ref>               (bare-string list item, only when inside `images:`)
function findImageRefOnLine(
  model: monaco.editor.ITextModel,
  lineNumber: number
): ImageHit | null {
  const line = model.getLineContent(lineNumber);

  const kw = line.match(/^(\s*)(?:-\s+)?(url|image):\s*(['"]?)/);
  if (kw) {
    const after = line.slice(kw[0].length);
    const valMatch = after.match(/^([^\s'"#]+)/);
    if (!valMatch) return null;
    const start = kw[0].length + 1;
    return { ref: valMatch[1], start, end: start + valMatch[1].length };
  }

  const li = line.match(/^(\s*)-\s+(['"]?)([^\s'"#-][^\s'"#]*)\2\s*(#.*)?$/);
  if (!li) return null;
  const itemIndent = li[1].length;
  let inImages = false;
  for (let n = lineNumber - 1; n >= 1; n--) {
    const up = model.getLineContent(n);
    if (/^\s*$/.test(up) || /^\s*#/.test(up)) continue;
    const im = up.match(/^(\s*)\S/);
    if (!im) continue;
    if (im[1].length >= itemIndent) continue;
    if (/^\s*images:\s*(#.*)?$/.test(up)) inImages = true;
    break;
  }
  if (!inImages) return null;
  const dashIdx = line.indexOf("- ");
  const refStart = line.indexOf(li[3], dashIdx + 2) + 1;
  return { ref: li[3], start: refStart, end: refStart + li[3].length };
}

// Walk up from `lineNumber` to find the enclosing `- type: question` block's
// `id:`. Returns null if the cursor is inside a non-question block.
function findCurrentQuestionId(
  model: monaco.editor.ITextModel,
  lineNumber: number
): string | null {
  let foundId: string | null = null;
  for (let n = lineNumber; n >= 1; n--) {
    const line = model.getLineContent(n);
    const typeMatch = line.match(/^\s*-\s+type:\s*(\w+)/);
    if (typeMatch) {
      return typeMatch[1] === "question" ? foundId : null;
    }
    if (!foundId) {
      const idMatch = line.match(/^\s*id:\s*['"]?([^'"\s#]+)/);
      if (idMatch) foundId = idMatch[1];
    }
  }
  return null;
}

function scanIDs(text: string): string[] {
  const out: string[] = [];
  const re = /^\s+id:\s*['"]?([^'"\s#]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].toLowerCase());
  return out;
}

// Pick three random uppercase letters that aren't already used — checks both
// the cross-event known IDs and the current document.
function generateUnusedID(text: string, knownIDs: Set<string>): string {
  const used = new Set(knownIDs);
  for (const id of scanIDs(text)) used.add(id);
  const A = 65;
  for (let i = 0; i < 100; i++) {
    const id = String.fromCharCode(
      A + Math.floor(Math.random() * 26),
      A + Math.floor(Math.random() * 26),
      A + Math.floor(Math.random() * 26)
    );
    if (!used.has(id.toLowerCase())) return id;
  }
  return "XYZ";
}

// Question slides are always direct children of the top-level `slides:` list,
// so the indent is fixed at one level (2 spaces). Detecting indent from the
// surrounding context picked up nested list items (e.g. inside `images:`)
// and over-indented the new block.
const QUESTION_INDENT = "  ";

// Find the last line of the slide block that contains `lineNumber`. Walks up
// to the enclosing `- type:` line, then forward until the next sibling slide
// or a dedent. Returns `lineNumber` unchanged if the cursor isn't inside any
// slide block (e.g. at the top of the doc before `slides:`).
function findSlideBlockEndLine(
  model: monaco.editor.ITextModel,
  lineNumber: number
): number {
  let slideStart = -1;
  let slideIndent = -1;
  for (let n = lineNumber; n >= 1; n--) {
    const m = model.getLineContent(n).match(/^(\s*)-\s+type:/);
    if (m) {
      slideStart = n;
      slideIndent = m[1].length;
      break;
    }
  }
  if (slideStart === -1) return lineNumber;

  const lineCount = model.getLineCount();
  for (let n = slideStart + 1; n <= lineCount; n++) {
    const line = model.getLineContent(n);
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const m = line.match(/^(\s*)(\S)/);
    if (!m) continue;
    const indent = m[1].length;
    const firstChar = m[2];
    // Dedent past the slide's own indent → block ended.
    if (indent < slideIndent) return n - 1;
    // Sibling slide at the same indent → block ended just before.
    if (indent === slideIndent && firstChar === "-") return n - 1;
  }
  return lineCount;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function EventEditor() {
  const { uuid } = useParams<{ uuid: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const etagRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editor data — refs so closures (providers, save) read the latest values
  // without triggering re-registration on every change.
  const sharedImageMapRef = useRef<Map<string, string>>(new Map());
  const eventImageMapRef = useRef<Map<string, string>>(new Map());
  const knownIDsRef = useRef<Set<string>>(new Set());
  const questionLineMapRef = useRef<Map<number, number>>(new Map());

  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  const savingRef = useRef(false);
  const isUnsaved = () =>
    savingRef.current ||
    saveTimerRef.current !== null ||
    conflictRef.current;

  // Resolve an image ref against the in-memory manifests. Returns absolute
  // URLs (location.origin + path) — Monaco's markdown renderer rewrites
  // schemeless URLs to file: which breaks them.
  function resolveEditorRef(
    ref: string
  ): { found: true; url: string } | { found: false; where: string } {
    const origin = window.location.origin;
    if (ref.startsWith("./")) {
      const key = ref.slice(2).toLowerCase();
      const filename = eventImageMapRef.current.get(key);
      if (!filename || !uuid)
        return { found: false, where: `events/${uuid ?? "?"}/images/` };
      return { found: true, url: `${origin}/events/${uuid}/images/${filename}` };
    }
    const key = ref.toLowerCase();
    const filename = sharedImageMapRef.current.get(key);
    if (!filename) return { found: false, where: "cdn/images/" };
    return { found: true, url: `${origin}/cdn/images/${filename}` };
  }

  // Load the YAML, image manifests, cross-event IDs, then mount Monaco and
  // register all providers. All disposables are tracked for cleanup.
  useEffect(() => {
    if (!uuid || !containerRef.current) return;
    let cancelled = false;
    const disposables: { dispose: () => void }[] = [];
    let parseTimer: ReturnType<typeof setTimeout> | null = null;
    let imagePreviewIds: string[] = [];
    const injectedThumbStyles = new Set<string>();
    const thumbUrlByClass = new Map<string, string>();

    // Custom DOM tooltip for gutter thumbs (Monaco's hover provider doesn't
    // fire on line-decoration cells).
    const thumbTooltip = document.createElement("div");
    thumbTooltip.id = "thumb-tooltip";
    const thumbTooltipImg = document.createElement("img");
    thumbTooltip.appendChild(thumbTooltipImg);
    document.body.appendChild(thumbTooltip);

    const ensureThumbStyle = (url: string) => {
      const cls = "img-thumb-" + url.replace(/[^a-z0-9]/gi, "_");
      if (!injectedThumbStyles.has(cls)) {
        injectedThumbStyles.add(cls);
        const style = document.createElement("style");
        style.textContent = `.${cls} { background-image: url("${url}"); }`;
        document.head.appendChild(style);
        disposables.push({ dispose: () => style.remove() });
        thumbUrlByClass.set(cls, url);
      }
      return cls;
    };

    const refreshImagePreviews = () => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;
      const decos: monaco.editor.IModelDeltaDecoration[] = [];
      for (let n = 1; n <= model.getLineCount(); n++) {
        const hit = findImageRefOnLine(model, n);
        if (!hit) continue;
        const resolved = resolveEditorRef(hit.ref);
        if (!resolved.found) continue;
        const cls = ensureThumbStyle(resolved.url);
        decos.push({
          range: new monaco.Range(n, 1, n, model.getLineMaxColumn(n)),
          options: { linesDecorationsClassName: `img-thumb ${cls}` },
        });
      }
      imagePreviewIds = editor.deltaDecorations(imagePreviewIds, decos);
    };

    // Fresh closure each call — Monaco's updateOptions skips re-render when
    // the lineNumbers function reference is unchanged.
    const makeLineNumberRenderer =
      (): monaco.editor.LineNumbersType => (n: number) => {
        const num = questionLineMapRef.current.get(n);
        return num === undefined ? "" : String(num);
      };

    const refreshQuestionGutter = () => {
      const editor = editorRef.current;
      if (!editor) return;
      questionLineMapRef.current = buildQuestionLineMap(editor.getValue());
      editor.updateOptions({ lineNumbers: makeLineNumberRenderer() });
      refreshImagePreviews();
    };

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

      // Start auxiliary fetches in parallel — none block the editor mount.
      const sharedManifestP = fetch("/cdn/images/manifest.json")
        .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
        .catch(() => [] as string[])
        .then((files) => {
          sharedImageMapRef.current = manifestToMap(files);
        });

      const eventImagesP = listEventImages(uuid)
        .then((files) => {
          eventImageMapRef.current = manifestToMap(files);
        })
        .catch(() => {
          /* non-fatal */
        });

      // Cross-event known IDs: list events, fetch each YAML, scan for ids.
      const knownIDsP = (async () => {
        try {
          const uuids = (await listEventUuids()).filter((u) => u !== uuid);
          const yamls = await Promise.all(
            uuids.map((u) => getYaml(u).catch(() => ({ text: "" })))
          );
          const ids = new Set<string>();
          for (const { text } of yamls) for (const id of scanIDs(text)) ids.add(id);
          knownIDsRef.current = ids;
        } catch {
          /* non-fatal */
        }
      })();

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
        lineNumbers: makeLineNumberRenderer(),
        lineNumbersMinChars: 3,
        // Reserved lane between line numbers and code for image thumbnails.
        lineDecorationsWidth: 56,
        renderLineHighlight: "line",
      });
      editorRef.current = editor;

      // Initial gutter + previews. Image manifests may still be loading, so
      // also re-run once they settle.
      refreshQuestionGutter();
      Promise.all([sharedManifestP, eventImagesP]).then(() => {
        if (!cancelled) refreshImagePreviews();
      });
      // knownIDs loads independently; consumers read the ref lazily.
      void knownIDsP;

      const changeSub = editor.onDidChangeModelContent(() => {
        if (!conflictRef.current) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);
        }
        if (parseTimer) clearTimeout(parseTimer);
        parseTimer = setTimeout(refreshQuestionGutter, PARSE_DEBOUNCE_MS);
      });
      disposables.push(changeSub);

      // Hover provider: image preview as markdown image.
      const hoverSub = monaco.languages.registerHoverProvider("yaml", {
        provideHover(model, position) {
          const hit = findImageRefOnLine(model, position.lineNumber);
          if (!hit) return null;
          if (position.column < hit.start || position.column > hit.end)
            return null;
          const resolved = resolveEditorRef(hit.ref);
          const value = resolved.found
            ? `![${hit.ref}](${resolved.url})`
            : `Image \`${hit.ref}\` not found in \`${resolved.where}\``;
          return {
            range: new monaco.Range(
              position.lineNumber,
              hit.start,
              position.lineNumber,
              hit.end
            ),
            contents: [{ value }],
          };
        },
      });
      disposables.push(hoverSub);

      // Completion provider: <id>, <id>-1, ... when typing url: in a
      // question's images: block.
      const completionSub = monaco.languages.registerCompletionItemProvider(
        "yaml",
        {
          triggerCharacters: [" ", "-"],
          provideCompletionItems(model, position) {
            const upToCursor = model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            });
            const m = upToCursor.match(
              /^\s*(?:-\s+)?url:\s*(['"]?)([^\s'"#]*)$/
            );
            if (!m) return { suggestions: [] };

            const id = findCurrentQuestionId(model, position.lineNumber);
            if (!id) return { suggestions: [] };
            const idLower = id.toLowerCase();

            const sharedMap = sharedImageMapRef.current;
            const existing = new Map<string, string>();
            for (const [key, filename] of sharedMap) {
              if (key === idLower || key.startsWith(idLower + "-")) {
                existing.set(key, filename);
              }
            }

            const candidates = new Set<string>([idLower, ...existing.keys()]);
            let maxN = 0;
            for (const key of existing.keys()) {
              const nm = key.match(/-(\d+)$/);
              if (nm) maxN = Math.max(maxN, parseInt(nm[1], 10));
            }
            candidates.add(`${idLower}-${maxN + 1}`);
            if (maxN > 0) candidates.add(`${idLower}-${maxN + 2}`);

            const sorted = [...candidates].sort((a, b) => {
              if (a === idLower) return -1;
              if (b === idLower) return 1;
              const an = parseInt(a.match(/-(\d+)$/)?.[1] || "0", 10);
              const bn = parseInt(b.match(/-(\d+)$/)?.[1] || "0", 10);
              return an - bn;
            });

            const partial = m[2];
            const replaceRange = new monaco.Range(
              position.lineNumber,
              position.column - partial.length,
              position.lineNumber,
              position.column
            );

            const suggestions = sorted.map((label, i) => {
              const filename = existing.get(label);
              const exists = !!filename;
              const url = exists
                ? `${window.location.origin}/cdn/images/${filename}`
                : null;
              return {
                label,
                kind: exists
                  ? monaco.languages.CompletionItemKind.Value
                  : monaco.languages.CompletionItemKind.Snippet,
                insertText: label,
                range: replaceRange,
                detail: exists ? "shared image" : "(not yet in cdn/)",
                sortText: String(i).padStart(3, "0"),
                documentation: url
                  ? { value: `![${label}](${url})` }
                  : undefined,
              };
            });

            return { suggestions };
          },
        }
      );
      disposables.push(completionSub);

      // Shift+Alt+Q new-question action.
      const action = editor.addAction({
        id: "trivia.newQuestion",
        label: "Trivia: New question",
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyQ,
        ],
        run: (ed) => {
          const id = generateUnusedID(ed.getValue(), knownIDsRef.current);
          const pos = ed.getPosition();
          const model = ed.getModel();
          if (!pos || !model) return;
          const indent = QUESTION_INDENT;
          const inner = indent + "  ";
          // Anchor at the end of the enclosing slide so the new block lands
          // after the current question, not in the middle of it.
          const anchorLine = findSlideBlockEndLine(model, pos.lineNumber);
          const eol = model.getLineMaxColumn(anchorLine);
          ed.setPosition({ lineNumber: anchorLine, column: eol });
          ed.trigger("keyboard", "type", { text: "\n" });
          ed.setPosition({ lineNumber: anchorLine + 1, column: 1 });
          const snippet =
            `${indent}- type: question\n` +
            `${inner}id: ${id}\n` +
            `${inner}question: \${1:question text}\n` +
            `${inner}answer: \${2:answer text}\n`;
          const snippetController = ed.getContribution(
            "snippetController2"
          ) as { insert(s: string): void } | null;
          snippetController?.insert(snippet);
        },
      });
      disposables.push(action);

      // Gutter-thumb hover tooltip — delegated mouseover/mouseout.
      const container = containerRef.current!;
      const onMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target?.classList.contains("img-thumb")) return;
        let url: string | null = null;
        for (const cls of target.classList) {
          if (thumbUrlByClass.has(cls)) {
            url = thumbUrlByClass.get(cls) ?? null;
            break;
          }
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
      if (parseTimer) clearTimeout(parseTimer);
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
  }, [uuid]);

  // beforeunload: warn on tab close / full reload while unsaved.
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

  const navigate = useNavigate();
  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    if (
      isUnsaved() &&
      !window.confirm(
        "You have unsaved edits. Leave anyway? Your changes will be lost."
      )
    ) {
      return;
    }
    navigate("/host/events");
  };

  async function save() {
    saveTimerRef.current = null;
    if (!uuid || conflictRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const etag = etagRef.current;
    if (!etag) return;

    const text = editor.getValue();
    savingRef.current = true;
    setSaveState({ kind: "saving" });

    try {
      const { etag: nextEtag } = await putYaml(uuid, text, etag);
      etagRef.current = nextEtag;
      setSaveState({ kind: "saved" });

      if (HAS_EVENT_LOCAL_REF.test(text)) {
        try {
          const files = await listEventImages(uuid);
          await putImagesManifest(uuid, files);
          eventImageMapRef.current = manifestToMap(files);
        } catch (e) {
          // Manifest regen failure is non-fatal — surface but don't block edits.
          console.warn("Failed to regenerate images manifest:", e);
        }
      }
    } catch (e) {
      if (e instanceof ConflictError) {
        conflictRef.current = true;
        setSaveState({ kind: "conflict" });
        return;
      }
      setSaveState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <div className="editor-paper min-h-screen flex flex-col">
      <header className="editor-header border-b">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between p-3">
          <div className="flex items-center gap-4">
            <a
              href="/host/events"
              onClick={handleBack}
              className="underline text-sm"
            >
              ← Events
            </a>
            <span className="text-sm text-gray-700">
              <code>{uuid}</code>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <SaveStatus state={saveState} />
            <span className="text-xs text-amber-800 bg-amber-50/80 border border-amber-200 rounded px-2 py-1">
              Editing live data
            </span>
          </div>
        </div>
      </header>

      {saveState.kind === "conflict" && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm">
          <div className="max-w-screen-xl mx-auto p-3">
            Someone else saved this event since you opened it. Auto-save is
            paused. Copy any edits you want to keep before reloading.
          </div>
        </div>
      )}

      {loadError && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm">
          <div className="max-w-screen-xl mx-auto p-3">
            Failed to load event: {loadError}
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        {!ready && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-700">
            Loading…
          </div>
        )}
        <div className="absolute inset-0 max-w-screen-xl mx-auto">
          <div ref={containerRef} className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  switch (state.kind) {
    case "idle":
      return <span className="text-xs text-gray-500">—</span>;
    case "saving":
      return <span className="text-xs text-gray-600">saving…</span>;
    case "saved":
      return <span className="text-xs text-green-700">saved</span>;
    case "error":
      return (
        <span className="text-xs text-red-700" title={state.message}>
          error
        </span>
      );
    case "conflict":
      return <span className="text-xs text-red-700">conflict — reload</span>;
  }
}
