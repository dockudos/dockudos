'use client';

import {
  type AskContext,
  EMBED_CLOSE_MESSAGE,
  EMBED_CONTEXT_MESSAGE,
  EMBED_READY_MESSAGE,
  embedUrl,
} from '@dockudos/core';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

/**
 * The docs assistant inside your own React product: a floating "Ask AI" button that opens the docs site's assistant in a
 * frame. It needs no styles from dockudos, so it works in any app. Nothing secret is involved: the frame talks to the docs
 * server, and your site must be listed in `ai.allowedOrigins` of the docs for the frame to be allowed.
 *
 *     <DocsAssistant siteUrl="https://docs.acme.com" context={{ hint: 'Billing settings' }} />
 */
export function DocsAssistant({
  siteUrl,
  context,
  label = 'Ask AI',
  position = 'right',
  color = '#18181b',
  defaultOpen = false,
}: {
  /** The address of the docs site. */
  siteUrl: string;
  /** Where the reader is in your product; changes are sent to the open assistant. */
  context?: AskContext;
  label?: string;
  position?: 'left' | 'right';
  /** Color of the button, as hex. */
  color?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [loaded, setLoaded] = useState(defaultOpen);
  const frame = useRef<HTMLIFrameElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  // The frame's address is fixed when it first opens; later changes of context go by message.
  const first = useRef(context);
  const origin = new URL(siteUrl).origin;
  const contextKey = JSON.stringify(context ?? null);

  const tell = () =>
    frame.current?.contentWindow?.postMessage(
      { type: EMBED_CONTEXT_MESSAGE, context: context ?? {} },
      origin,
    );
  useEffect(tell, [contextKey]);

  // The frame says when it is ready to hear where the reader is.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown } | null;
      if (e.source !== frame.current?.contentWindow) return;
      if (data?.type === EMBED_READY_MESSAGE) tell();
      // Escape pressed inside the frame never reaches this page, so the frame asks for the close.
      if (data?.type === EMBED_CLOSE_MESSAGE) {
        setOpen(false);
        launch.current?.focus();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        launch.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#18181b';
  const font = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const side: CSSProperties = position === 'left' ? { left: 20 } : { right: 20 };

  return (
    <div style={{ fontFamily: font, fontSize: 14, lineHeight: 1.4 }}>
      <button
        ref={launch}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setLoaded(true);
        }}
        style={{
          position: 'fixed',
          bottom: 20,
          ...side,
          zIndex: 2147483000,
          height: 44,
          padding: '0 18px',
          border: 0,
          borderRadius: 999,
          background: safeColor,
          color: '#fff',
          font: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,.25)',
        }}
      >
        {label}
      </button>
      <div
        role="dialog"
        aria-label="Ask the docs"
        hidden={!open}
        style={{
          position: 'fixed',
          bottom: 76,
          ...side,
          zIndex: 2147483000,
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          width: 'min(400px, calc(100vw - 40px))',
          height: 'min(640px, calc(100vh - 100px))',
          overflow: 'hidden',
          border: '1px solid rgba(0,0,0,.15)',
          borderRadius: 12,
          background: '#fff',
          boxShadow: '0 12px 40px rgba(0,0,0,.3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 8px 6px 14px',
            borderBottom: '1px solid rgba(0,0,0,.1)',
            background: '#fafafa',
            color: '#18181b',
            fontWeight: 600,
          }}
        >
          <span>Ask the docs</span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setOpen(false);
              launch.current?.focus();
            }}
            style={{
              width: 32,
              height: 32,
              border: 0,
              borderRadius: 6,
              background: 'transparent',
              color: '#18181b',
              fontSize: 20,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
        {loaded && (
          <iframe
            ref={frame}
            title="Ask the docs"
            src={embedUrl(siteUrl, first.current)}
            onLoad={tell}
            style={{ flex: 1, width: '100%', border: 0, background: '#fff' }}
          />
        )}
      </div>
    </div>
  );
}
