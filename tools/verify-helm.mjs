#!/usr/bin/env node
// Renders the Helm chart with several sets of values and checks the result without a cluster:
//  - every manifest parses, and `required` values fail loudly when missing
//  - Services select the pods they should; the Ingress points at Services that exist
//  - the environment of every platform container is accepted by the platform's own `loadConfig`
//  - pods run as non-root with no privilege escalation
// Needs the `helm` binary (HELM=/path/to/helm to choose one) and a built @dockudos/platform.
import { spawnSync } from 'node:child_process';
import { parseAllDocuments } from 'yaml';
import { loadConfig } from '@dockudos/platform';

const helm = process.env.HELM ?? 'helm';
const chart = new URL('../deploy/helm/dockudos', import.meta.url).pathname;
const SECRET = 's'.repeat(40);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failures++; };

const render = (sets) => spawnSync(helm, ['template', 'docs', chart, ...Object.entries(sets).flatMap(([k, v]) => ['--set', `${k}=${v}`])], { encoding: 'utf8' });
const docs = (out) => parseAllDocuments(out).map((d) => d.toJS()).filter(Boolean);

const trial = { 'secrets.sessionSecret': SECRET, 'postgresql.enabled': 'true', 'postgresql.auth.password': 'pgpw', 'minio.enabled': 'true', 'minio.auth.password': 'miniopw' };
const production = {
  'secrets.existingSecret': 'my-secrets', 'config.s3.endpoint': 'https://s3.example.com', 'api.autoscaling.enabled': 'true', 'site.autoscaling.enabled': 'true',
  'ingress.tls.enabled': 'true', 'ingress.className': 'nginx', 'networkPolicy.enabled': 'true', 'config.oidc.issuer': 'https://idp.example.com',
  'config.oidc.clientId': 'dockudos', 'config.agent.enabled': 'true', 'config.agent.llmProvider': 'anthropic', 'config.agent.llmModel': 'm',
  'config.publicUrl': 'https://docs-admin.example.com:8443', 'config.sitesDomain': 'sites.example.org',
};

for (const [name, sets] of [['trial install (bundled Postgres and MinIO)', trial], ['production values (external services, autoscaling, TLS)', production]]) {
  console.log(`\n# ${name}`);
  const r = render(sets);
  check('renders', r.status === 0, r.stderr);
  if (r.status !== 0) continue;
  const all = docs(r.stdout);
  const kinds = (k) => all.filter((d) => d.kind === k);
  const names = (k) => kinds(k).map((d) => d.metadata.name);
  const services = new Map(kinds('Service').map((s) => [s.metadata.name, s]));

  for (const s of services.values()) {
    const sel = s.spec.selector;
    const match = [...kinds('Deployment'), ...kinds('StatefulSet')].some((w) => Object.entries(sel).every(([k, v]) => w.spec.template.metadata.labels?.[k] === v));
    check(`service ${s.metadata.name} selects a workload`, match);
  }
  for (const ing of kinds('Ingress'))
    for (const rule of ing.spec.rules) for (const p of rule.http.paths) check(`ingress ${rule.host}${p.path} -> existing service`, services.has(p.backend.service.name));
  const ingress = kinds('Ingress')[0];
  check('ingress has the dashboard host (port stripped) and a wildcard sites host', ingress.spec.rules[0].host === (sets['config.publicUrl'] ? 'docs-admin.example.com' : 'docs-admin.example.com') && ingress.spec.rules[1].host.startsWith('*.'));

  for (const w of kinds('Deployment')) {
    const pod = w.spec.template.spec;
    check(`${w.metadata.name}: non-root, no privilege escalation, resource requests`, pod.securityContext.runAsNonRoot === true &&
      [...(pod.initContainers ?? []), ...pod.containers].every((c) => c.securityContext?.allowPrivilegeEscalation === false) && pod.containers.every((c) => c.resources?.requests));
    for (const c of [...(pod.initContainers ?? []), ...pod.containers]) {
      if (!c.env?.some((e) => e.name === 'DOCKUDOS_SERVICES')) continue;
      // Resolve secret references the way the cluster would.
      const env = {};
      for (const e of c.env) env[e.name] = e.value ?? (e.name === 'DOCKUDOS_SESSION_SECRET' ? SECRET : e.name.endsWith('DATABASE_URL') ? 'postgres://u:p@db/x' : e.name === 'DOCKUDOS_LLM_API_KEY' ? 'sk-llm-key' : 'resolved-secret-value');
      try { loadConfig(env); check(`${w.metadata.name}/${c.name}: environment accepted by the platform`, true); }
      catch (e) { check(`${w.metadata.name}/${c.name}: environment accepted by the platform`, false, e.message); }
    }
  }
  check('every Deployment has a rolling update that never drops below capacity', kinds('Deployment').filter((d) => d.spec.strategy?.rollingUpdate).every((d) => d.spec.strategy.rollingUpdate.maxUnavailable === 0));
  if (sets['api.autoscaling.enabled']) {
    check('autoscaled deployments do not pin replicas', kinds('Deployment').filter((d) => /-(api|site)$/.test(d.metadata.name)).every((d) => d.spec.replicas === undefined));
    check('HPAs exist for api and site', names('HorizontalPodAutoscaler').length === 2);
    check('network policy restricts the worker', names('NetworkPolicy').length === 1);
    const secretRefs = kinds('Deployment').flatMap((d) => d.spec.template.spec.containers.flatMap((c) => c.env ?? [])).filter((e) => e.valueFrom?.secretKeyRef);
    check('secrets come from the existing Secret', secretRefs.length > 0 && secretRefs.every((e) => e.valueFrom.secretKeyRef.name === 'my-secrets'));
    check('no Secret is created by the chart', names('Secret').length === 0);
  } else {
    check('bundled Postgres and MinIO are present', names('StatefulSet').length === 1 && kinds('Deployment').some((d) => d.metadata.name.endsWith('-minio')));
    check('the chart-created Secret holds the database URL', kinds('Secret').some((s) => s.stringData?.DOCKUDOS_DATABASE_URL?.includes('pgpw@docs-dockudos-postgresql')));
  }
  check('a smoke-test pod is included', kinds('Pod').some((p) => p.metadata.annotations?.['helm.sh/hook'] === 'test'));
}

console.log('\n# refusing incomplete values');
const s3 = { 'config.s3.endpoint': 'https://s3.example.com' };
const missing = [
  ['no session secret', { ...s3, 'postgresql.enabled': 'true', 'postgresql.auth.password': 'x' }, 'secrets.sessionSecret'],
  ['no database', { ...s3, 'secrets.sessionSecret': SECRET }, 'secrets.databaseUrl'],
  ['bundled Postgres without a password', { ...s3, 'secrets.sessionSecret': SECRET, 'postgresql.enabled': 'true' }, 'postgresql.auth.password'],
  ['no object storage', { 'secrets.sessionSecret': SECRET, 'secrets.databaseUrl': 'postgres://u:p@h/d' }, 'config.s3.endpoint'],
  ['bundled MinIO without a password', { 'secrets.sessionSecret': SECRET, 'secrets.databaseUrl': 'postgres://u:p@h/d', 'minio.enabled': 'true' }, 'minio.auth.password'],
];
for (const [name, sets, expect] of missing) {
  const r = render(sets);
  check(`${name} is refused with a message naming ${expect}`, r.status !== 0 && r.stderr.includes(expect), r.stderr.slice(0, 200));
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
