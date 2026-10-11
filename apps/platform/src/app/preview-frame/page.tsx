'use client';

import '@dockudos/ui/styles.css';
import { useEffect, useState } from 'react';
import { MdxPreview } from '../../components/mdx-preview';

/**
 * Served with `Content-Security-Policy: sandbox allow-scripts; connect-src 'none'`: an opaque origin with no network.
 * The editor sends the text with `postMessage`; nothing here can reach the dashboard's cookies or API.
 */
export default function PreviewFrame() {
  const [source, setSource] = useState('');
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== window.parent || !e.data || e.data.type !== 'render')
        return;
      setSource(String(e.data.source ?? ''));
      document.documentElement.classList.toggle('dark', e.data.dark === true);
      document.documentElement.style.colorScheme = e.data.dark
        ? 'dark'
        : 'light';
    };
    window.addEventListener('message', on);
    window.parent.postMessage({ type: 'ready' }, '*');
    return () => window.removeEventListener('message', on);
  }, []);
  return <MdxPreview source={source} />;
}
