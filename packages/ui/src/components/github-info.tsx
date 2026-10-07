import { GitFork, Star } from 'lucide-react';

export interface GithubInfoProps {
  owner: string;
  repo: string;
}

interface RepoData {
  description: string | null;
  stargazers_count: number;
  forks_count: number;
}

async function fetchRepo(
  owner: string,
  repo: string,
): Promise<RepoData | undefined> {
  try {
    const token = process.env['GITHUB_TOKEN'];
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as RepoData) : undefined;
  } catch {
    return undefined;
  }
}

const compact = new Intl.NumberFormat('en', { notation: 'compact' });

/**
 * Repository card with stars and forks, fetched when the page is built. If
 * GitHub cannot be reached it still renders a working link, without numbers.
 */
const NAME = /^[A-Za-z0-9_.-]+$/;

export async function GithubInfo({ owner, repo }: GithubInfoProps) {
  if (
    !NAME.test(owner) ||
    !NAME.test(repo) ||
    owner === '..' ||
    repo === '..'
  ) {
    throw new Error(
      `<GithubInfo>: "${owner}/${repo}" is not a GitHub owner and repository name`,
    );
  }
  const data = await fetchRepo(owner, repo);
  return (
    <a
      href={`https://github.com/${owner}/${repo}`}
      target="_blank"
      rel="noreferrer noopener"
      className="not-prose my-5 block rounded-lg border bg-card p-4 no-underline transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="block font-semibold text-foreground">
        {owner}/{repo}
        <span className="sr-only"> on GitHub (opens in a new tab)</span>
      </span>
      {data?.description && (
        <span className="mt-1 block text-sm text-muted-foreground">
          {data.description}
        </span>
      )}
      {data && (
        <span className="mt-3 flex gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Star className="size-3.5" aria-hidden="true" />
            {compact.format(data.stargazers_count)}
            <span className="sr-only"> stars</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <GitFork className="size-3.5" aria-hidden="true" />
            {compact.format(data.forks_count)}
            <span className="sr-only"> forks</span>
          </span>
        </span>
      )}
    </a>
  );
}
