import { useCallback, useEffect, useRef } from 'react';
import type { HoverMessage, PickedMessage, ReadyMessage } from './types';

interface BridgeHandlers {
  onPicked?: (m: PickedMessage) => void;
  onReady?: (m: ReadyMessage) => void;
  onHover?: (m: HoverMessage) => void;
}

/**
 * Bridges the React parent and the injected selector script inside the proxied
 * iframe via window.postMessage. The iframe src is /api/proxy-page, which Vite
 * proxies to the backend so it stays same-origin with the app — that lets us
 * also read contentDocument directly for live selector testing (testSelector/
 * countMatches below). Other API calls go direct to the backend via CORS.
 */
export function useSelectorBridge(handlers: BridgeHandlers) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data;
      if (!d || d.source !== 'scraper-iframe') return;
      if (d.type === 'picked') handlersRef.current.onPicked?.(d as PickedMessage);
      else if (d.type === 'ready') handlersRef.current.onReady?.(d as ReadyMessage);
      else if (d.type === 'hover') handlersRef.current.onHover?.(d as HoverMessage);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const post = useCallback((msg: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ ...msg, source: 'scraper-parent' }, '*');
  }, []);

  const arm = useCallback(
    (field: string, opts: { color?: string; multi?: boolean } = {}) =>
      post({ type: 'arm', field, ...opts }),
    [post],
  );
  const disarm = useCallback(() => post({ type: 'disarm' }), [post]);
  const clear = useCallback((field: string) => post({ type: 'clear', field }), [post]);
  const clearAll = useCallback(() => post({ type: 'clearAll' }), [post]);

  /** Run a CSS selector against the (same-origin) iframe doc for live testing. */
  const testSelector = useCallback((selector: string, type: 'text' | 'html' = 'text') => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return null;
      const el = doc.querySelector(selector);
      if (!el) return null;
      return type === 'html' ? el.innerHTML.trim() : (el.textContent || '').trim();
    } catch {
      return null;
    }
  }, []);

  const countMatches = useCallback((selector: string) => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return 0;
      return doc.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }, []);

  return { iframeRef, arm, disarm, clear, clearAll, testSelector, countMatches };
}
