'use client';

import { Check, X } from 'lucide-react';
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useId,
  useState,
} from 'react';
import { usePageData } from '../docs-context.tsx';
import { useLocalStorage } from '../hooks/use-local-storage.ts';
import { elementChildren } from '../lib/children.ts';
import { md, type ToMarkdown } from '@dockudos/core';

export interface AnswerProps {
  /** This is a right answer. One right answer makes a single choice; several make "select all". */
  correct?: boolean;
  children?: ReactNode;
}

/** One choice in a `Question`, which reads its props and renders it; this renders nothing itself. */
export function Answer(_props: AnswerProps) {
  return null;
}

export interface QuestionProps {
  /** The question. */
  text: string;
  /** Shown after the reader checks, and on paper. */
  explanation?: ReactNode;
  /** Keeps the saved answer when the wording changes. Defaults to the question text. */
  id?: string;
  /** `Answer` elements, and nothing else. */
  children: ReactNode;
}

interface QuizState {
  /** The checked selection for each question, as answer positions. */
  submitted: Record<string, number[]>;
  submit: (id: string, selection: number[]) => void;
  retry: (id: string) => void;
}

const QuizContext = createContext<QuizState | null>(null);

const questionId = (p: Pick<QuestionProps, 'id' | 'text'>) => p.id ?? p.text;

// Elements are matched by their props, not their type: when MDX is rendered on the server, `Answer` and
// `Question` reach this code as client references, and `el.type === Answer` is never true.
const answersOf = (children: ReactNode) =>
  elementChildren<AnswerProps>(children);

const correctIndexes = (children: ReactNode) =>
  answersOf(children).flatMap((el, i) => (el.props.correct ? [i] : []));

const isRight = (selection: number[], children: ReactNode) => {
  const want = correctIndexes(children);
  return (
    selection.length === want.length && want.every((i) => selection.includes(i))
  );
};

function useQuizState(storageId?: string): QuizState {
  const { path } = usePageData();
  const [submitted, setSubmitted] = useLocalStorage<Record<string, number[]>>(
    storageId ? `dockudos:quiz:${path}:${storageId}` : null,
    {},
  );
  return {
    submitted,
    submit: (id, selection) => setSubmitted((p) => ({ ...p, [id]: selection })),
    retry: (id) =>
      setSubmitted((p) => {
        const { [id]: _removed, ...rest } = p;
        return rest;
      }),
  };
}

export interface QuizProps {
  /** Remembers the answers in this browser. Unique on the page; changing it starts a fresh quiz. */
  id?: string;
  /** Heading above the questions. */
  title?: string;
  /** `Question` elements, and any text between them. */
  children: ReactNode;
}

/** A set of questions with instant feedback and a score. */
export function Quiz({ id, title, children }: QuizProps) {
  const state = useQuizState(id);
  const questions = elementChildren<QuestionProps>(children).filter(
    (el) => typeof el.props.text === 'string',
  );
  const answered = questions.filter(
    (q) => state.submitted[questionId(q.props)],
  );
  const right = answered.filter((q) =>
    isRight(state.submitted[questionId(q.props)] as number[], q.props.children),
  ).length;
  const finished = questions.length > 0 && answered.length === questions.length;

  return (
    <QuizContext.Provider value={state}>
      <section className="dk-quiz" aria-label={title ?? 'Quiz'}>
        {title && <p className="dk-quiz-title">{title}</p>}
        {children}
        <div className="dk-quiz-footer" data-print="hide">
          <p role="status" className="dk-quiz-score">
            {finished
              ? `You got ${right} of ${questions.length} right.`
              : answered.length > 0
                ? `${answered.length} of ${questions.length} answered.`
                : ''}
          </p>
          {answered.length > 0 && (
            <button
              type="button"
              className="dk-quiz-button"
              onClick={() =>
                answered.forEach((q) => state.retry(questionId(q.props)))
              }
            >
              Start again
            </button>
          )}
        </div>
      </section>
    </QuizContext.Provider>
  );
}

/** One question. Inside a `Quiz` it counts towards the score; on its own it just gives feedback. */
export function Question(props: QuestionProps): ReactElement {
  const quiz = useContext(QuizContext);
  return quiz ? (
    <QuestionBody {...props} quiz={quiz} />
  ) : (
    <Standalone {...props} />
  );
}

function Standalone(props: QuestionProps) {
  const state = useQuizState();
  return <QuestionBody {...props} quiz={state} />;
}

function QuestionBody({
  text,
  explanation,
  id,
  children,
  quiz,
}: QuestionProps & { quiz: QuizState }) {
  const uid = useId();
  const key = questionId({ id, text });
  const answers = answersOf(children);
  const multiple = correctIndexes(children).length > 1;
  const [picked, setPicked] = useState<number[]>([]);
  const checked = quiz.submitted[key];
  const selection = checked ?? picked;
  const right = checked ? isRight(checked, children) : false;

  const toggle = (i: number) =>
    setPicked((p) =>
      multiple ? (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]) : [i],
    );

  return (
    <fieldset
      className="dk-question"
      data-result={checked ? (right ? 'right' : 'wrong') : undefined}
    >
      <legend className="dk-question-text">{text}</legend>
      <p className="dk-question-hint">
        {multiple ? 'Select all that apply.' : 'Choose one.'}
      </p>
      <ul className="dk-answers">
        {answers.map((el, i) => {
          const chosen = selection.includes(i);
          const state = checked
            ? el.props.correct
              ? 'correct'
              : chosen
                ? 'wrong'
                : undefined
            : undefined;
          return (
            <li key={i}>
              <label
                className="dk-answer"
                data-state={state}
                data-chosen={chosen ? '' : undefined}
                data-correct={el.props.correct ? '' : undefined}
              >
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={uid}
                  checked={chosen}
                  disabled={!!checked}
                  onChange={() => toggle(i)}
                />
                <span className="dk-answer-mark" aria-hidden="true">
                  {state === 'correct' ? (
                    <Check className="size-3.5" />
                  ) : state === 'wrong' ? (
                    <X className="size-3.5" />
                  ) : null}
                </span>
                <span className="dk-answer-text">{el.props.children}</span>
                {state === 'correct' && (
                  <span className="sr-only"> (correct answer)</span>
                )}
                {state === 'wrong' && (
                  <span className="sr-only"> (your answer, incorrect)</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="dk-question-actions" data-print="hide">
        {checked ? (
          <button
            type="button"
            className="dk-quiz-button"
            onClick={() => quiz.retry(key)}
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            className="dk-quiz-button dk-quiz-primary"
            disabled={picked.length === 0}
            onClick={() => {
              quiz.submit(
                key,
                [...picked].sort((a, b) => a - b),
              );
              setPicked([]);
            }}
          >
            Check answer
          </button>
        )}
        <span role="status" className="dk-question-verdict">
          {checked ? (right ? 'Correct.' : 'Not quite.') : ''}
        </span>
      </div>
      {explanation && (
        <div className="dk-question-explanation" hidden={!checked}>
          {explanation}
        </div>
      )}
    </fieldset>
  );
}

Quiz.toMarkdown = ((props, children) =>
  md.section(md.bold(props.title ? `Quiz: ${props.title}` : 'Quiz'), children)) satisfies ToMarkdown<{ title?: string }>;
Question.toMarkdown = ((props, children) => {
  const explanation = md.text(props.explanation);
  return md.section(md.bold(props.text), `${children.trim()}\n\n${explanation ? md.italic(`Explanation: ${explanation}`) : ''}`);
}) satisfies ToMarkdown<{ text: string; explanation?: string }>;
Answer.toMarkdown = ((props, children) =>
  md.item(`${children.trim()}${props.correct ? ' (correct)' : ''}`)) satisfies ToMarkdown<{ correct?: boolean }>;
