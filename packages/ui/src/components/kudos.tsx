'use client';

import { Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { cn } from '../lib/utils.ts';

export interface KudosProps {
  /** Site path of the page being rated, such as `/guides/auth`. */
  path: string;
  /** Where votes are sent. Default `/api/kudos`. */
  endpoint?: string;
  /** The question. Default "Was this page helpful?". */
  prompt?: string;
}

type Vote = 'up' | 'down';
type Stage =
  | { name: 'ask' }
  | { name: 'sending'; vote: Vote }
  | { name: 'comment'; vote: Vote; id: string }
  | { name: 'done'; vote: Vote; commented: boolean };

const STORAGE_KEY = 'dockudos-kudos';
const MAX_COMMENT = 1000;

function remembered(path: string): { id: string; vote: Vote } | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      { id: string; vote: Vote }
    >;
    const entry = all[path];
    return entry && (entry.vote === 'up' || entry.vote === 'down')
      ? entry
      : undefined;
  } catch {
    return undefined;
  }
}

function remember(path: string, value: { id: string; vote: Vote }) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...all, [path]: value }),
    );
  } catch {
    // storage unavailable: the visitor can vote again, which is harmless
  }
}

async function send(endpoint: string, body: object): Promise<{ id: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { id: string };
}

/**
 * "Was this page helpful?" with a thumbs up or down, then an optional comment.
 * One vote per page per browser (remembered locally). Nothing that identifies the visitor is sent.
 */
export function Kudos({
  path,
  endpoint = '/api/kudos',
  prompt = 'Was this page helpful?',
}: KudosProps) {
  const [stage, setStage] = useState<Stage>({ name: 'ask' });
  const [error, setError] = useState<string>();
  const [comment, setComment] = useState('');
  const headingId = useId();
  const commentId = useId();

  // Read the remembered vote after mount so server and first client render agree.
  useEffect(() => {
    const prior = remembered(path);
    setStage(
      prior
        ? { name: 'done', vote: prior.vote, commented: true }
        : { name: 'ask' },
    );
    setComment('');
    setError(undefined);
  }, [path]);

  const vote = async (value: Vote) => {
    setError(undefined);
    setStage({ name: 'sending', vote: value });
    try {
      const { id } = await send(endpoint, { path, vote: value });
      remember(path, { id, vote: value });
      setStage({ name: 'comment', vote: value, id });
    } catch {
      setStage({ name: 'ask' });
      setError('Could not send your vote. Please try again.');
    }
  };

  const submit = async (e: FormEvent, id: string, value: Vote) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setError(undefined);
    try {
      await send(endpoint, { path, id, comment: comment.trim() });
      setStage({ name: 'done', vote: value, commented: true });
    } catch {
      setError('Could not send your comment. Please try again.');
    }
  };

  const chosen = stage.name === 'ask' ? undefined : stage.vote;

  return (
    <section aria-labelledby={headingId} className="dk-kudos" data-print="hide">
      <h2 id={headingId} className="dk-kudos-title">
        {stage.name === 'done' ? 'Thanks for your feedback' : prompt}
      </h2>

      {stage.name !== 'done' && (
        <div
          className="dk-kudos-votes"
          role="group"
          aria-labelledby={headingId}
        >
          {(['up', 'down'] as const).map((value) => {
            const Icon = value === 'up' ? ThumbsUp : ThumbsDown;
            const active = chosen === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                disabled={stage.name !== 'ask'}
                onClick={() => void vote(value)}
                className={cn('dk-kudos-button', active && 'is-active')}
              >
                <Icon className="size-4" aria-hidden="true" />
                {value === 'up' ? 'Yes' : 'No'}
              </button>
            );
          })}
        </div>
      )}

      {stage.name === 'comment' && (
        <form
          className="dk-kudos-form"
          onSubmit={(e) => void submit(e, stage.id, stage.vote)}
        >
          <label htmlFor={commentId}>
            {stage.vote === 'up'
              ? 'Glad it helped. Anything we could do better?'
              : 'What was missing or wrong?'}{' '}
            <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id={commentId}
            value={comment}
            maxLength={MAX_COMMENT}
            rows={3}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="dk-kudos-actions">
            <button
              type="submit"
              className="dk-kudos-send"
              disabled={!comment.trim()}
            >
              Send comment
            </button>
            <button
              type="button"
              className="dk-kudos-skip"
              onClick={() =>
                setStage({ name: 'done', vote: stage.vote, commented: false })
              }
            >
              No thanks
            </button>
            <span className="dk-kudos-count" aria-hidden="true">
              {comment.length}/{MAX_COMMENT}
            </span>
          </div>
        </form>
      )}

      {stage.name === 'done' && (
        <p className="dk-kudos-thanks">
          <Check className="size-4" aria-hidden="true" /> Your feedback helps us
          improve these docs.
        </p>
      )}

      <p
        role="status"
        aria-live="polite"
        className={cn('dk-kudos-error', !error && 'sr-only')}
      >
        {error}
      </p>
    </section>
  );
}
