import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const base = {
  DOCKUDOS_DATABASE_URL: 'postgres://dockudos:dbpassword123@postgres:5432/dockudos',
  DOCKUDOS_PUBLIC_URL: 'https://platform.example.com/',
  DOCKUDOS_SESSION_SECRET: 'x'.repeat(40),
};

describe('loadConfig', () => {
  it('reads a minimal environment and applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ dbPoolMax: 10, port: 4000, logLevel: 'info', publicUrl: 'https://platform.example.com', workerConcurrency: 2, agentEnabled: false });
    expect(c.services).toEqual(['web', 'hooks', 'analytics', 'auth', 'editor', 'worker', 'agent', 'site']);
    expect(c.analytics).toEqual({ logConversations: false, retentionDays: 90, conversationRetentionDays: 30 });
    expect(c.s3).toBeUndefined();
    expect(c.oidc).toBeUndefined();
  });

  it('collects every secret value for the logger, including the database password', () => {
    const c = loadConfig({ ...base, DOCKUDOS_GITHUB_TOKEN: 'ghp_abcdefghijkl', DOCKUDOS_LLM_API_KEY: 'sk-llm-key-123', DOCKUDOS_METRICS_TOKEN: 'metrics-token' });
    expect(c.secrets).toEqual(expect.arrayContaining(['x'.repeat(40), 'ghp_abcdefghijkl', 'sk-llm-key-123', 'metrics-token', 'dbpassword123']));
  });

  it('reads optional blocks only when complete', () => {
    const c = loadConfig({
      ...base, DOCKUDOS_S3_ENDPOINT: 'http://minio:9000', DOCKUDOS_S3_ACCESS_KEY: 'ak', DOCKUDOS_S3_SECRET_KEY: 'sk123456',
      DOCKUDOS_OIDC_ISSUER: 'https://idp.example.com', DOCKUDOS_OIDC_CLIENT_ID: 'dockudos', DOCKUDOS_ADMIN_EMAIL: 'Boss@Example.com',
      DOCKUDOS_LLM_PROVIDER: 'anthropic', DOCKUDOS_LLM_MODEL: 'm', DOCKUDOS_LLM_API_KEY: 'k'.repeat(10),
      DOCKUDOS_SITES_DOMAIN: 'Sites.Example.org', DOCKUDOS_SERVICES: 'hooks, worker',
    });
    expect(c.s3).toMatchObject({ endpoint: 'http://minio:9000', bucket: 'dockudos', region: 'us-east-1' });
    expect(c.oidc).toMatchObject({ issuer: 'https://idp.example.com', clientId: 'dockudos' });
    expect(c.adminEmail).toBe('boss@example.com');
    expect(c.llm).toMatchObject({ provider: 'anthropic', model: 'm' });
    expect(c.sitesDomain).toBe('sites.example.org');
    expect(c.services).toEqual(['hooks', 'worker']);
    expect(loadConfig({ ...base, DOCKUDOS_LLM_PROVIDER: 'openai', DOCKUDOS_LLM_MODEL: 'm' }).llm).toBeUndefined();
  });

  it('reports every problem at once, never echoing a secret', () => {
    try {
      loadConfig({ DOCKUDOS_PUBLIC_URL: 'not a url', DOCKUDOS_SESSION_SECRET: 'short-secret', DOCKUDOS_SERVICES: 'web,bogus', DOCKUDOS_S3_ENDPOINT: 'http://m:9000', DOCKUDOS_OIDC_ISSUER: 'https://i' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      for (const needle of ['DOCKUDOS_DATABASE_URL', 'DOCKUDOS_PUBLIC_URL', 'DOCKUDOS_SESSION_SECRET', 'bogus', 'go together', 'OIDC_CLIENT_ID'])
        expect(msg, needle).toContain(needle);
      expect(msg).not.toContain('short-secret');
    }
  });

  it('refuses a sites domain that shares the platform host', () => {
    expect(() => loadConfig({ ...base, DOCKUDOS_SITES_DOMAIN: 'platform.example.com' })).toThrow('own host');
    expect(() => loadConfig({ ...base, DOCKUDOS_SITES_DOMAIN: 'example.com' })).toThrow('own host');
    expect(() => loadConfig({ ...base, DOCKUDOS_SITES_DOMAIN: 'sites.example.net' })).not.toThrow();
    expect(() => loadConfig({ ...base, DOCKUDOS_SITES_DOMAIN: 'sites.platform.example.com' })).not.toThrow();
  });

  it('parses booleans and numbers', () => {
    const c = loadConfig({ ...base, DOCKUDOS_AGENT_ENABLED: 'true', DOCKUDOS_ANALYTICS_LOG_CONVERSATIONS: '1', DOCKUDOS_PORT: '8080', DOCKUDOS_FETCH_ALLOW_HOSTS: 'Git.Internal, ,x.test' });
    expect(c).toMatchObject({ agentEnabled: true, port: 8080, fetchAllowHosts: ['git.internal', 'x.test'] });
    expect(c.analytics.logConversations).toBe(true);
    expect(() => loadConfig({ ...base, DOCKUDOS_PORT: '70000' })).toThrow('DOCKUDOS_PORT');
  });
});
