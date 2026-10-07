// @vitest-environment jsdom
import { WIDGET_BODY, WIDGET_SCRIPT, createWidgetHandler } from './widget.ts';

function load(
  attributes: Record<string, string> = {},
  src = 'https://docs.acme.com/dockudos-widget.js',
) {
  const script = document.createElement('script');
  script.src = src;
  for (const [k, v] of Object.entries(attributes)) script.setAttribute(k, v);
  document.head.appendChild(script);
  new Function('document', 'window', 'script', WIDGET_BODY)(
    document,
    window,
    script,
  );
  const host = document.querySelector('[data-dockudos-widget]') as HTMLElement;
  const root = host?.shadowRoot as ShadowRoot;
  return {
    host,
    root,
    launch: root?.querySelector('.launch') as HTMLButtonElement,
    panel: root?.querySelector('.panel') as HTMLElement,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { Dockudos?: unknown }).Dockudos;
});

describe('widget script', () => {
  it('is plain JavaScript with no template literals, so it can be served as it is', () => {
    expect(
      () => new Function('document', 'window', 'script', WIDGET_BODY),
    ).not.toThrow();
    expect(WIDGET_BODY).not.toContain('`');
    expect(
      WIDGET_SCRIPT.endsWith('(document, window, document.currentScript);\n'),
    ).toBe(true);
  });

  it('adds a labelled button and a closed dialog, and loads nothing until opened', () => {
    const { launch, panel, root } = load({ 'data-label': 'Help me' });
    expect(launch.textContent).toBe('Help me');
    expect(launch.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(root.querySelector('iframe')).toBeNull();
  });

  it('opens the site’s own assistant in a frame, with the context in its address', () => {
    const { launch, panel, root } = load({
      'data-hint': 'Billing settings',
      'data-path': '/guides/billing',
    });
    launch.click();
    expect(panel.hidden).toBe(false);
    expect(launch.getAttribute('aria-expanded')).toBe('true');
    const frame = root.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.src).toBe(
      'https://docs.acme.com/embed?path=%2Fguides%2Fbilling&hint=Billing+settings',
    );
    expect(frame.title).toBe('Ask the docs');
    launch.click();
    expect(panel.hidden).toBe(true);
    expect(root.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('closes with Escape and with the close button, and gives focus back', () => {
    const { launch, panel, root } = load();
    const focus = vi.spyOn(launch, 'focus');
    window.Dockudos?.open();
    expect(panel.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
    expect(focus).toHaveBeenCalled();
    launch.click();
    (root.querySelector('.close') as HTMLButtonElement).click();
    expect(panel.hidden).toBe(true);
    // Escape does nothing while it is closed.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
  });

  it('tells the frame where the reader is, to the site’s origin only', () => {
    const { launch, root } = load();
    launch.click();
    const frame = root.querySelector('iframe') as HTMLIFrameElement;
    const post = vi.fn();
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage: post },
    });
    window.Dockudos?.setContext({
      hint: '  Invoices  ',
      path: '/guides/billing',
      evil: 1,
    } as never);
    expect(post).toHaveBeenCalledWith(
      {
        type: 'dockudos:context',
        context: { path: '/guides/billing', hint: 'Invoices' },
      },
      'https://docs.acme.com',
    );
    window.Dockudos?.setContext({ hint: 5, path: 'nope' } as never);
    expect(post).toHaveBeenLastCalledWith(
      { type: 'dockudos:context', context: {} },
      'https://docs.acme.com',
    );
  });

  it('sends the context again when the frame says it is ready, but only to its own frame', () => {
    const { launch, root } = load({ 'data-hint': 'Invoices' });
    launch.click();
    const frame = root.querySelector('iframe') as HTMLIFrameElement;
    const post = vi.fn();
    const win = { postMessage: post };
    Object.defineProperty(frame, 'contentWindow', { value: win });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'dockudos:ready' },
        source: window,
      }),
    );
    expect(post).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'dockudos:ready' },
        source: win as unknown as Window,
      }),
    );
    expect(post).toHaveBeenCalledWith(
      { type: 'dockudos:context', context: { hint: 'Invoices' } },
      'https://docs.acme.com',
    );
  });

  it('closes when the frame reports Escape, but not on the word of another window', () => {
    const { launch, panel, root } = load();
    launch.click();
    const frame = root.querySelector('iframe') as HTMLIFrameElement;
    const win = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'contentWindow', { value: win });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'dockudos:close' },
        source: window,
      }),
    );
    expect(panel.hidden).toBe(false);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'dockudos:close' },
        source: win as unknown as Window,
      }),
    );
    expect(panel.hidden).toBe(true);
  });

  it('puts the button on the left when asked, and ignores a bad color', () => {
    const { root } = load({
      'data-position': 'left',
      'data-color': 'red;}body{display:none',
    });
    const css = root.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.launch{bottom:20px;left:20px');
    expect(css).toContain('background:#18181b');
    expect(css).not.toContain('body{display:none');
    document.body.innerHTML = '';
    delete (window as unknown as { Dockudos?: unknown }).Dockudos;
    const good = load({ 'data-color': '#16a34a' });
    expect(good.root.querySelector('style')?.textContent).toContain(
      'background:#16a34a',
    );
  });

  it('does not put the label in as HTML, and does nothing twice or with a script it cannot place', () => {
    const { launch } = load({ 'data-label': '<img src=x onerror=alert(1)>' });
    expect(launch.querySelector('img')).toBeNull();
    expect(launch.textContent).toBe('<img src=x onerror=alert(1)>');
    load();
    expect(document.querySelectorAll('[data-dockudos-widget]')).toHaveLength(1);
    delete (window as unknown as { Dockudos?: unknown }).Dockudos;
    document.body.innerHTML = '';
    new Function('document', 'window', 'script', WIDGET_BODY)(
      document,
      window,
      null,
    );
    expect(document.querySelector('[data-dockudos-widget]')).toBeNull();
  });
});

declare global {
  interface Window {
    Dockudos?: {
      open(): void;
      close(): void;
      toggle(): void;
      setContext(c: object): void;
    };
  }
}

describe('createWidgetHandler', () => {
  it('serves the script as JavaScript, cacheable and not sniffable', async () => {
    const res = createWidgetHandler()();
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toContain('max-age');
    expect(await res.text()).toBe(WIDGET_SCRIPT);
  });
});
