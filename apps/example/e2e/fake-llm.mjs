// A stand-in for an OpenAI-compatible language model, so the e2e tests exercise the real adapter and
// the real streaming path without a key or a network. It answers from the first excerpt it is given,
// cites it, and records what it was sent (GET /__calls) so tests can check the request.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_LLM_PORT ?? 4399);
const calls = [];

const EXCERPT =
  /<<<EXCERPT (\S+) (\d+) \| ([^\n]*?)>>>\n([\s\S]*?)\n<<<END \1>>>/g;

const STOP = new Set(
  'the and for are but not you your how what when why where which who can could should would does did its our any all out has have had was were been being into from with about that this these those there their them then than too very just also may might will shall need get got one two use used using make'.split(
    ' ',
  ),
);
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s|e)$/, '') : w);
const words = (text) =>
  (text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map(stem);

function answerFor(userMessage) {
  const excerpts = [...userMessage.matchAll(EXCERPT)].map((m) => ({
    n: Number(m[2]),
    text: m[4],
  }));
  const question = /Question: ([\s\S]*)$/.exec(userMessage)?.[1] ?? '';
  if (excerpts.length === 0) return 'NO_ANSWER';
  const candidates = excerpts.flatMap(({ n, text }) =>
    (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]/g) ?? [text]).map(
      (sentence) => ({
        n,
        sentence: sentence.trim(),
        words: new Set(words(sentence)),
      }),
    ),
  );
  // Words that few sentences contain say more about the question than words every sentence has.
  const idf = (w) =>
    Math.log(
      1 +
        candidates.length /
          (1 + candidates.filter((c) => c.words.has(w)).length),
    );
  const asked = [...new Set(words(question))];
  const score = (c) =>
    asked.filter((w) => c.words.has(w)).reduce((sum, w) => sum + idf(w), 0);
  const best = candidates.sort((a, b) => score(b) - score(a))[0];
  return `${best.sentence} [${best.n}]`;
}

const server = createServer((req, res) => {
  if (req.url === '/__calls') {
    if (req.method === 'DELETE') calls.length = 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(calls));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = JSON.parse(raw);
      calls.push({ authorization: req.headers.authorization, body });
      const last = body.messages.at(-1)?.content ?? '';
      const text = answerFor(last);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of text.match(/\S+\s*/g) ?? []) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
        );
        await new Promise((r) => setTimeout(r, 15));
      }
      res.end('data: [DONE]\n\n');
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, '127.0.0.1', () =>
  console.log(`fake LLM listening on ${port}`),
);
