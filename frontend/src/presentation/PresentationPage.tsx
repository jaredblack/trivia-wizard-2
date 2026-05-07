import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import yaml from 'js-yaml';
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import './presentation.css';
import {
  collectCustomFileRefs,
  renderSlides,
  resolveCustomFileUrl,
  type BuildContext,
  type PresentationData,
} from './build';

const CDN_BASE = '/cdn';

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  return r.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

export default function PresentationPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const [error, setError] = useState<string | null>(null);
  const [render, setRender] = useState<{ html: string; bgUrl: string } | null>(null);
  const revealRef = useRef<HTMLDivElement>(null);

  // Load EB Garamond + Shrikhand from Google Fonts only while this page is mounted.
  useEffect(() => {
    const links: HTMLLinkElement[] = [
      Object.assign(document.createElement('link'), {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      }),
      Object.assign(document.createElement('link'), {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      }),
      Object.assign(document.createElement('link'), {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..800;1,400..800&family=Shrikhand&display=swap',
      }),
    ];
    links.forEach((l) => document.head.appendChild(l));
    return () => links.forEach((l) => l.remove());
  }, []);

  // Fetch deck + manifests + custom slide HTML, then render.
  useEffect(() => {
    if (!uuid) return;
    const eventBase = `/events/${uuid}`;
    let cancelled = false;
    (async () => {
      try {
        const yamlText = await fetchText(`${eventBase}/event.yaml`);
        const data = yaml.load(yamlText) as PresentationData;

        const [sharedImages, eventImages] = await Promise.all([
          fetchJson<string[]>(`${CDN_BASE}/images/manifest.json`),
          fetchJson<string[]>(`${eventBase}/images/manifest.json`).catch(
            () => [] as string[]
          ),
        ]);

        const customRefs = collectCustomFileRefs(data);
        const customEntries = await Promise.all(
          customRefs.map(async (ref) => {
            const url = resolveCustomFileUrl(ref, {
              cdnBase: CDN_BASE,
              eventBase,
            });
            const html = await fetchText(url);
            return [ref, html] as const;
          })
        );
        const customSlides = new Map(customEntries);

        const ctx: BuildContext = {
          cdnBase: CDN_BASE,
          eventBase,
          sharedImages,
          eventImages,
          customSlides,
        };
        const out = renderSlides(data, ctx);
        if (cancelled) return;
        setRender({ html: out.slidesHtml, bgUrl: out.bgUrl });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  // Initialize reveal.js once slides HTML is in the DOM.
  useEffect(() => {
    if (!render || !revealRef.current) return;
    const deck = new Reveal(revealRef.current, {
      hash: true,
      controls: false,
      progress: false,
      center: false,
      transition: 'none',
      width: 1920,
      height: 1080,
      margin: 0,
    });
    deck.initialize();
    return () => {
      deck.destroy();
    };
  }, [render]);

  if (error) {
    return (
      <div style={{ padding: 20, color: '#b00' }}>
        <h2>Failed to load presentation</h2>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!render) {
    return <div style={{ padding: 20 }}>Loading…</div>;
  }

  return (
    <div
      className="presentation-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        ['--bg-url' as string]: `url('${render.bgUrl}')`,
      } as React.CSSProperties}
    >
      <div className="reveal" ref={revealRef}>
        <div
          className="slides"
          dangerouslySetInnerHTML={{ __html: render.html }}
        />
      </div>
    </div>
  );
}
