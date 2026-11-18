import { useEffect } from 'react';

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..800;1,400..800&family=Shrikhand&display=swap';

/** Load the slide fonts from Google Fonts for as long as the caller is mounted. */
export function usePresentationFonts(): void {
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
      Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT_CSS }),
    ];
    links.forEach((l) => document.head.appendChild(l));
    return () => links.forEach((l) => l.remove());
  }, []);
}
