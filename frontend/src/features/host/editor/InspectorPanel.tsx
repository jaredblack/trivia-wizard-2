import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 280;
// Dragging narrower than this snaps the panel shut.
const COLLAPSE_BELOW = 200;
// Always leave the editor at least this much room.
const MIN_EDITOR_WIDTH = 320;
const STORAGE_KEY = "trivia.editor.inspector";

interface Stored {
  width: number;
  collapsed: boolean;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Stored>;
      return {
        width: typeof v.width === "number" ? Math.max(MIN_WIDTH, v.width) : DEFAULT_WIDTH,
        collapsed: v.collapsed === true,
      };
    }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return { width: DEFAULT_WIDTH, collapsed: false };
}

function maxWidth() {
  return Math.max(MIN_WIDTH, window.innerWidth - MIN_EDITOR_WIDTH);
}

/** Right-hand side panel that can be resized by dragging its left edge and
 *  collapsed to a thin rail. Width and collapsed state persist per browser. */
export default function InspectorPanel({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Stored>(load);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore: persistence is a convenience only.
    }
  }, [state]);

  const setCollapsed = useCallback(
    (collapsed: boolean) => setState((s) => ({ ...s, collapsed })),
    []
  );

  // Cmd/Ctrl+\ toggles the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setState((s) => ({ ...s, collapsed: !s.collapsed }));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, width: state.collapsed ? 0 : state.width };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const raw = start.width + (start.x - e.clientX);
    if (raw < COLLAPSE_BELOW) {
      setState((s) => (s.collapsed ? s : { ...s, collapsed: true }));
    } else {
      const width = Math.min(maxWidth(), Math.max(MIN_WIDTH, raw));
      setState({ width, collapsed: false });
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? step : -step;
      setState((s) => ({
        collapsed: false,
        width: Math.min(maxWidth(), Math.max(MIN_WIDTH, (s.collapsed ? MIN_WIDTH : s.width) + delta)),
      }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      setState((s) => ({ ...s, collapsed: !s.collapsed }));
    }
  };

  const width = Math.min(state.width, maxWidth());

  return (
    <div className="flex shrink-0 min-h-0 relative">
      {/* Full-screen overlay while dragging keeps the cursor and stops Monaco
          and the preview from swallowing pointer events. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuenow={state.collapsed ? 0 : width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        className={`inspector-resizer ${dragging ? "active" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setState({ width: DEFAULT_WIDTH, collapsed: false })}
        onKeyDown={onHandleKey}
      />
      {state.collapsed ? (
        <div className="inspector inspector-rail" data-testid="inspector-rail">
          <button
            type="button"
            className="inspector-toggle"
            onClick={() => setCollapsed(false)}
            aria-label="Show inspector"
            title="Show inspector (⌘\)"
          >
            <PanelRightOpen size={16} />
          </button>
        </div>
      ) : (
        <div className="inspector-panel relative flex min-h-0" style={{ width }}>
          <button
            type="button"
            className="inspector-toggle inspector-toggle-floating"
            onClick={() => setCollapsed(true)}
            aria-label="Hide inspector"
            title="Hide inspector (⌘\)"
          >
            <PanelRightClose size={16} />
          </button>
          {children}
        </div>
      )}
    </div>
  );
}
