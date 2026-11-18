import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "reveal.js/reveal.css";
import "../../../presentation/presentation.css";
import "./inspector.css";
import type { DeckSlide } from "../../../deck/types";
import { backgroundUrl, renderSlide, type RenderContext } from "../../../presentation/render";
import { fitQuestionSlide } from "../../../presentation/fit";
import { usePresentationFonts } from "../../../presentation/fonts";

const SLIDE_WIDTH = 1920;

interface SlidePreviewProps {
  slide: DeckSlide;
  ctx: RenderContext;
  /** Show the slide as it looks after the answer is revealed. */
  revealed: boolean;
}

/**
 * The real slide, rendered by the same code as the projector and scaled down.
 * reveal.js itself isn't running here, so the reveal state is applied by hand.
 */
export default function SlidePreview({ slide, ctx, revealed }: SlidePreviewProps) {
  usePresentationFonts();
  const frameRef = useRef<HTMLDivElement>(null);
  const slidesRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  const html = useMemo(() => renderSlide(slide, ctx), [slide, ctx]);
  const bg = useMemo(() => backgroundUrl(ctx), [ctx]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setScale(frame.clientWidth / SLIDE_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const section = slidesRef.current?.querySelector<HTMLElement>("section");
    if (!section) return;
    section.classList.add("present");
    section.querySelectorAll(".fragment").forEach((el) => {
      el.classList.toggle("visible", revealed);
    });
    fitQuestionSlide(section);
    // Text metrics shift when the slide fonts arrive.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) fitQuestionSlide(section);
    });
    return () => {
      cancelled = true;
    };
  }, [html, revealed]);

  return (
    <div
      ref={frameRef}
      className="slide-preview presentation-root"
      data-testid="slide-preview"
      style={
        {
          "--bg-url": bg ? `url('${bg}')` : "none",
          "--preview-scale": scale,
        } as React.CSSProperties
      }
    >
      <div className="reveal">
        <div ref={slidesRef} className="slides" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
