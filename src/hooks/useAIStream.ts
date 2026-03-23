'use client';

import { useState, useCallback, useRef } from 'react';

interface UseAIStreamOptions {
  onDone?: (content: string) => void;
  onError?: (error: string) => void;
}

export function useAIStream(options?: UseAIStreamOptions) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (type: string, params?: Record<string, unknown>, noCache?: boolean) => {
    setContent('');
    setError('');
    setLoading(true);
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params, noCache }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `请求失败: ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data.cached) {
          setContent(data.content);
          setLoading(false);
          options?.onDone?.(data.content);
          return;
        }
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              accumulated += data.text;
              setContent(accumulated);
            }
            if (data.error) {
              setError(data.error);
              setLoading(false);
              options?.onError?.(data.error);
              return;
            }
            if (data.done) {
              setLoading(false);
              options?.onDone?.(accumulated);
              return;
            }
          } catch {}
        }
      }

      setLoading(false);
      options?.onDone?.(accumulated);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLoading(false);
      options?.onError?.(msg);
    }
  }, [options]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const reset = useCallback(() => {
    setContent('');
    setError('');
    setLoading(false);
  }, []);

  return { content, loading, error, generate, abort, reset };
}
