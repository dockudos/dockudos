export type HealthCheck = () => Promise<void>;

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, { ok: boolean; ms: number; error?: string }>;
}

/**
 * Liveness says the process is up; readiness says its dependencies answer. Orchestrators restart on the first
 * and stop routing on the second. A check that hangs counts as failed after `timeoutMs`.
 */
export function createHealth(checks: Record<string, HealthCheck>, timeoutMs = 3000) {
  return {
    live: () => ({ status: 'ok' as const }),
    async ready(): Promise<HealthReport> {
      const report: HealthReport = { status: 'ok', checks: {} };
      await Promise.all(
        Object.entries(checks).map(async ([name, check]) => {
          const start = Date.now();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              check(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
              }),
            ]);
            report.checks[name] = { ok: true, ms: Date.now() - start };
          } catch (error) {
            report.status = 'degraded';
            report.checks[name] = {
              ok: false,
              ms: Date.now() - start,
              // The message may name a host, never a credential: the logger scrubs, and so do we here.
              error: error instanceof Error ? error.message.split('\n')[0]! : 'failed',
            };
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      return report;
    },
  };
}
