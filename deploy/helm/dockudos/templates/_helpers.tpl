{{- define "dockudos.name" -}}{{ .Chart.Name }}{{- end -}}
{{- define "dockudos.fullname" -}}
{{- if .Values.fullnameOverride -}}{{ .Values.fullnameOverride | trunc 50 | trimSuffix "-" }}
{{- else -}}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" }}{{- end -}}
{{- end -}}
{{- define "dockudos.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: {{ include "dockudos.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "dockudos.selector" -}}
app.kubernetes.io/name: {{ include "dockudos.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}
{{- define "dockudos.image" -}}{{ printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}{{- end -}}
{{- define "dockudos.editorImage" -}}{{ printf "%s:%s" .Values.editorImage.repository (default .Chart.AppVersion .Values.editorImage.tag) }}{{- end -}}
{{- define "dockudos.secretName" -}}{{ default (printf "%s-secrets" (include "dockudos.fullname" .)) .Values.secrets.existingSecret }}{{- end -}}
{{- define "dockudos.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
{{ printf "postgres://%s:%s@%s-postgresql:5432/%s" .Values.postgresql.auth.username (required "postgresql.auth.password is required when postgresql.enabled" .Values.postgresql.auth.password) (include "dockudos.fullname" .) .Values.postgresql.auth.database }}
{{- else -}}{{ .Values.secrets.databaseUrl }}{{- end -}}
{{- end -}}

{{/* A secret key as an optional env var. */}}
{{- define "dockudos.secretEnv" -}}
- name: {{ .name }}
  valueFrom:
    secretKeyRef: { name: {{ .secret }}, key: {{ .name }}, optional: true }
{{- end -}}

{{/* The environment every platform container gets. `services` is the roles it plays. */}}
{{- define "dockudos.env" -}}
{{- $secret := include "dockudos.secretName" .ctx -}}
{{- $v := .ctx.Values -}}
- { name: DOCKUDOS_SERVICES, value: {{ .services | quote }} }
- { name: DOCKUDOS_PUBLIC_URL, value: {{ $v.config.publicUrl | quote }} }
- { name: DOCKUDOS_SITES_DOMAIN, value: {{ $v.config.sitesDomain | quote }} }
- { name: DOCKUDOS_LOG_LEVEL, value: {{ $v.config.logLevel | quote }} }
- { name: DOCKUDOS_WORKER_CONCURRENCY, value: {{ $v.config.workerConcurrency | quote }} }
- { name: DOCKUDOS_DB_POOL_MAX, value: {{ $v.config.dbPoolMax | quote }} }
- { name: DOCKUDOS_TRUST_PROXY, value: {{ $v.config.trustProxy | quote }} }
- { name: DOCKUDOS_PORT, value: "4000" }
- { name: DOCKUDOS_DATA_DIR, value: /var/lib/dockudos }
- { name: DOCKUDOS_GITHUB_API_URL, value: {{ $v.config.git.githubApiUrl | quote }} }
- { name: DOCKUDOS_GITLAB_API_URL, value: {{ $v.config.git.gitlabApiUrl | quote }} }
- { name: DOCKUDOS_S3_BUCKET, value: {{ if $v.minio.enabled }}{{ "dockudos" | quote }}{{ else }}{{ $v.config.s3.bucket | quote }}{{ end }} }
- { name: DOCKUDOS_S3_REGION, value: {{ $v.config.s3.region | quote }} }
- { name: DOCKUDOS_S3_ENDPOINT, value: {{ if $v.minio.enabled }}{{ printf "http://%s-minio:9000" (include "dockudos.fullname" .ctx) | quote }}{{ else }}{{ required "config.s3.endpoint is required when minio.enabled is false" $v.config.s3.endpoint | quote }}{{ end }} }
- { name: DOCKUDOS_ANALYTICS_LOG_CONVERSATIONS, value: {{ $v.config.analytics.logConversations | quote }} }
- { name: DOCKUDOS_ANALYTICS_RETENTION_DAYS, value: {{ $v.config.analytics.retentionDays | quote }} }
- { name: DOCKUDOS_CONVERSATION_RETENTION_DAYS, value: {{ $v.config.analytics.conversationRetentionDays | quote }} }
- { name: DOCKUDOS_AGENT_ENABLED, value: {{ $v.config.agent.enabled | quote }} }
{{- with $v.config.agent.llmProvider }}
- { name: DOCKUDOS_LLM_PROVIDER, value: {{ . | quote }} }
- { name: DOCKUDOS_LLM_MODEL, value: {{ $v.config.agent.llmModel | quote }} }
{{- with $v.config.agent.llmBaseUrl }}
- { name: DOCKUDOS_LLM_BASE_URL, value: {{ . | quote }} }
{{- end }}
{{- end }}
{{- with $v.config.oidc.issuer }}
- { name: DOCKUDOS_OIDC_ISSUER, value: {{ . | quote }} }
- { name: DOCKUDOS_OIDC_CLIENT_ID, value: {{ $v.config.oidc.clientId | quote }} }
- { name: DOCKUDOS_OIDC_ROLES_CLAIM, value: {{ $v.config.oidc.rolesClaim | quote }} }
- { name: DOCKUDOS_OIDC_GROUPS_CLAIM, value: {{ $v.config.oidc.groupsClaim | quote }} }
{{- end }}
{{- with $v.config.oidc.adminEmail }}
- { name: DOCKUDOS_ADMIN_EMAIL, value: {{ . | quote }} }
{{- end }}
{{- with $v.config.cookieDomain }}
- { name: DOCKUDOS_COOKIE_DOMAIN, value: {{ . | quote }} }
{{- end }}
{{- with $v.config.fetchAllowHosts }}
- { name: DOCKUDOS_FETCH_ALLOW_HOSTS, value: {{ . | quote }} }
{{- end }}
{{- range $name := list "DOCKUDOS_SESSION_SECRET" "DOCKUDOS_DATABASE_URL" "DOCKUDOS_S3_ACCESS_KEY" "DOCKUDOS_S3_SECRET_KEY" "DOCKUDOS_GITHUB_TOKEN" "DOCKUDOS_GITLAB_TOKEN" "DOCKUDOS_OIDC_CLIENT_SECRET" "DOCKUDOS_LLM_API_KEY" "DOCKUDOS_DOCS_AUTH_SECRET" "DOCKUDOS_METRICS_TOKEN" }}
{{ include "dockudos.secretEnv" (dict "name" $name "secret" $secret) }}
{{- end }}
{{- with $v.config.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* Security context shared by every pod. */}}
{{- define "dockudos.podSecurity" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile: { type: RuntimeDefault }
{{- end -}}
{{- define "dockudos.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: { drop: [ALL] }
{{- end -}}
