import { extractiveLLM, mockLLM } from './ai-mock.ts';
import type { AskLimits } from './ask.ts';
import { buildContentIndex } from './content-index.ts';
import {
  type EvalDeps,
  type EvalSet,
  evalMetrics,
  evalRegressions,
  runEval,
} from './eval.ts';
import { KeywordSearch } from './keyword-search.ts';

const pages = [
  {
    path: '/guides/auth',
    title: 'Authentication',
    body: '## API keys\n\nCreate a key in the dashboard. Rotate a key every ninety days.\n\n## Errors\n\nA bad key returns status 401 with the code ERR_INVALID_KEY.',
  },
  {
    path: '/guides/billing',
    title: 'Billing',
    body: '## Change the billing email\n\nOpen Settings, then Billing, and edit the email address that receives invoices.\n\n## Invoices\n\nInvoices are generated on the first day of each month.',
  },
  {
    path: '/guides/limits',
    title: 'Rate limits',
    body: '## Limits\n\nEach key may send 60 requests per minute.\n\n## Retry\n\nWhen you receive a 429 response, wait and retry with backoff.',
  },
];

const limits: AskLimits = {
  maxQuestionLength: 500,
  maxOutputTokens: 300,
  maxHistoryTurns: 4,
  contextTokens: 2000,
};

const { index } = buildContentIndex(pages);
const deps = (over: Partial<EvalDeps> = {}): EvalDeps => ({
  siteName: 'Acme',
  index,
  keyword: new KeywordSearch(index),
  limits,
  llm: extractiveLLM(),
  ...over,
});

const set: EvalSet = {
  questions: [
    {
      id: 'rotate',
      question: 'How often should I rotate a key?',
      expect: ['/guides/auth#api-keys'],
    },
    {
      id: 'email',
      question: 'How do I change the billing email?',
      expect: ['/guides/billing'],
    },
    {
      id: 'rate',
      question: 'How many requests can a key send per minute?',
      expect: ['/guides/limits#limits'],
    },
  ],
  unanswerable: [
    { id: 'capital', question: 'What is the capital of Australia?' },
    { id: 'poem', question: 'Write me a poem about llamas on the moon' },
  ],
  navigation: [
    {
      id: 'nav-email',
      query: 'change the billing email',
      expect: '/guides/billing#change-the-billing-email',
    },
    {
      id: 'nav-retry',
      query: 'retry after a 429 response',
      expect: '/guides/limits#retry',
    },
  ],
};

describe('extractiveLLM', () => {
  it('answers from the sentence that shares most words with the question, and cites it', async () => {
    const report = await runEval(deps(), {
      ...set,
      questions: [set.questions[0] as EvalSet['questions'][number]],
      unanswerable: [],
      navigation: [],
    });
    expect(report.citations.cited).toBe(1);
    expect(report.refusals.rate).toBe(1);
  });

  it('declines when no sentence shares enough with the question', async () => {
    const llm = extractiveLLM();
    const out: string[] = [];
    for await (const p of llm.generate({
      system: '',
      messages: [
        {
          role: 'user',
          content:
            '<<<EXCERPT n 1 | A>>>\nBilling happens monthly.\n<<<END n>>>\n\nQuestion: How tall is the Eiffel Tower in metres',
        },
      ],
    }))
      out.push(p);
    expect(out.join('')).toBe('NO_ANSWER');
  });
});

describe('runEval', () => {
  it('measures a site that does everything right', async () => {
    const report = await runEval(deps(), set);
    expect(report.retrieval).toMatchObject({
      rate: 1,
      passed: 3,
      total: 3,
      failed: [],
    });
    expect(report.citations).toMatchObject({
      validity: 1,
      invalid: 0,
      uncited: [],
    });
    expect(report.citations.cited).toBeGreaterThanOrEqual(3);
    expect(report.refusals).toMatchObject({ rate: 1, total: 5, failed: [] });
    expect(report.navigation.search.rate).toBe(1);
    expect(report.navigation.model?.rate).toBe(1);
    expect(report.firstToken?.p50).toBeGreaterThanOrEqual(0);
    expect(report.firstToken?.p95).toBeGreaterThanOrEqual(
      report.firstToken?.p50 ?? 0,
    );
    expect(evalMetrics(report)).toEqual({
      retrievalHitRate: 1,
      citationValidity: 1,
      refusalAccuracy: 1,
      navigationAccuracySearch: 1,
      navigationAccuracyModel: 1,
    });
  });

  it('names the cases that fail', async () => {
    const report = await runEval(deps(), {
      questions: [
        {
          id: 'wrong-page',
          question: 'How do I change the billing email?',
          expect: ['/guides/auth'],
        },
        {
          id: 'ok',
          question: 'How often should I rotate a key?',
          expect: ['/guides/auth'],
        },
      ],
      unanswerable: [
        // Answerable in fact, so a good system will answer it: counted as a failed refusal.
        {
          id: 'not-really-unanswerable',
          question: 'How often should I rotate a key?',
        },
      ],
      navigation: [
        {
          id: 'nav-wrong',
          query: 'change the billing email',
          expect: '/guides/auth',
        },
      ],
    });
    expect(report.retrieval).toMatchObject({
      rate: 0.5,
      failed: ['wrong-page'],
    });
    expect(report.refusals.failed).toEqual(['not-really-unanswerable']);
    expect(report.navigation.search.failed).toEqual(['nav-wrong']);
  });

  it('counts a citation that points at no real heading as invalid', async () => {
    const broken = structuredClone(index);
    for (const chunk of broken.chunks)
      if (chunk.anchor === 'api-keys') chunk.anchor = 'no-such-heading';
    const report = await runEval(
      deps({ index: broken, keyword: new KeywordSearch(broken) }),
      {
        questions: [set.questions[0] as EvalSet['questions'][number]],
        unanswerable: [],
        navigation: [],
      },
    );
    expect(report.citations.invalid).toBe(1);
    expect(report.citations.validity).toBe(0);
  });

  it('lists answers that cite nothing, and counts a refusal of an answerable question', async () => {
    const report = await runEval(deps({ llm: mockLLM(() => 'It depends.') }), {
      ...set,
      unanswerable: [],
      navigation: [],
    });
    expect(report.citations.uncited).toEqual(['rotate', 'email', 'rate']);
    expect(report.citations.validity).toBe(1);
    const refuser = await runEval(deps({ llm: mockLLM(() => 'NO_ANSWER') }), {
      ...set,
      unanswerable: [],
      navigation: [],
    });
    expect(refuser.refusals.rate).toBe(0);
  });

  it('runs retrieval and search navigation with no model, skipping the rest', async () => {
    const report = await runEval(deps({ llm: undefined }), set);
    expect(report.retrieval.rate).toBe(1);
    expect(report.navigation.search.rate).toBe(1);
    expect(report.navigation.model).toBeUndefined();
    expect(report.refusals.total).toBe(0);
    expect(report.citations.cited).toBe(0);
    expect(evalMetrics(report)).not.toHaveProperty('navigationAccuracyModel');
  });
});

describe('evalRegressions', () => {
  const baseline = {
    retrievalHitRate: 0.8,
    citationValidity: 1,
    refusalAccuracy: 0.9,
  };

  it('passes a run that is as good, or better', () => {
    expect(
      evalRegressions(
        { retrievalHitRate: 0.9, citationValidity: 1, refusalAccuracy: 0.9 },
        baseline,
      ),
    ).toEqual([]);
  });

  it('reports what got worse, and requires every citation to be valid', () => {
    expect(
      evalRegressions(
        { retrievalHitRate: 0.7, citationValidity: 0.99, refusalAccuracy: 0.9 },
        baseline,
      ),
    ).toEqual([
      'citationValidity is 0.99, it must be 1',
      'retrievalHitRate fell from 0.8 to 0.7',
    ]);
  });

  it('reports a metric that is no longer measured', () => {
    expect(evalRegressions({ citationValidity: 1 }, baseline)).toEqual([
      'retrievalHitRate was not measured',
      'refusalAccuracy was not measured',
    ]);
  });
});
