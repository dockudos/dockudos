/**
 * The normalised model every API source (OpenAPI, AsyncAPI, GraphQL) is turned into, and that generated pages embed.
 * It is plain JSON on purpose: it is written to disk at build time and read by the browser.
 */

export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;
export type ApiMethod = (typeof HTTP_METHODS)[number];

export type SchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

/**
 * A schema with OpenAPI 3.0 and 3.1 differences removed: `nullable` replaces `type: [x, "null"]`, exclusive bounds are
 * numbers, `example`s are a list. A `$ref` becomes `ref`, the name of an entry in `ApiModel.schemas`, so circular
 * schemas are finite trees: a viewer expands a reference when asked to, instead of following it forever.
 */
export interface ApiSchema {
  /** A reference to `ApiModel.schemas[ref]`. Other fields may be present when the stub was expanded one level. */
  ref?: string;
  type?: SchemaType;
  /** More than one type (`type: ["string", "integer"]` in 3.1). `type` is then unset. */
  types?: SchemaType[];
  nullable?: boolean;
  format?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  properties?: Record<string, ApiSchema>;
  required?: string[];
  items?: ApiSchema;
  additionalProperties?: boolean | ApiSchema;
  oneOf?: ApiSchema[];
  anyOf?: ApiSchema[];
  allOf?: ApiSchema[];
  not?: ApiSchema;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
}

export interface ApiExample {
  summary?: string;
  description?: string;
  value: unknown;
}

export interface ApiMediaType {
  schema?: ApiSchema;
  /** Named examples from the spec, or one generated from the schema when the spec has none. */
  examples: Record<string, ApiExample>;
}

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export interface ApiParameter {
  name: string;
  in: ParameterLocation;
  required: boolean;
  description?: string;
  deprecated?: boolean;
  schema?: ApiSchema;
  example?: unknown;
  style?: string;
  explode?: boolean;
}

export interface ApiRequestBody {
  description?: string;
  required: boolean;
  /** By media type, in the order of the spec. */
  content: Record<string, ApiMediaType>;
}

export interface ApiHeader {
  name: string;
  description?: string;
  schema?: ApiSchema;
}

export interface ApiResponse {
  /** `200`, `404`, `2XX` or `default`. */
  status: string;
  description?: string;
  headers: ApiHeader[];
  content: Record<string, ApiMediaType>;
}

export type ApiSecurityScheme =
  | {
      type: 'apiKey';
      in: 'header' | 'query' | 'cookie';
      name: string;
      description?: string;
    }
  | {
      type: 'http';
      /** `bearer`, `basic`, or another HTTP authentication scheme. */
      scheme: string;
      bearerFormat?: string;
      description?: string;
    }
  | {
      type: 'oauth2';
      flows: Record<
        string,
        {
          authorizationUrl?: string;
          tokenUrl?: string;
          refreshUrl?: string;
          scopes: Record<string, string>;
        }
      >;
      description?: string;
    }
  | { type: 'openIdConnect'; url: string; description?: string }
  | { type: 'mutualTLS'; description?: string };

export interface ApiServer {
  url: string;
  description?: string;
  variables?: Record<
    string,
    { default: string; enum?: string[]; description?: string }
  >;
}

/** One alternative of an operation's security: all of its schemes are needed together. */
export type ApiSecurityRequirement = Record<string, string[]>;

export interface ApiOperation {
  /** Unique within the model and stable between builds: the `operationId`, else derived from method and path. */
  id: string;
  method: ApiMethod;
  /** The path with `{placeholders}`, or the webhook name for a webhook. */
  path: string;
  /** Set for an entry of `webhooks`: the API sends it to you, so there is nothing to try. */
  webhook?: boolean;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated?: boolean;
  /** Path-level and operation-level parameters, the operation's winning on a clash. */
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponse[];
  /** Alternatives; any one satisfies the operation. Empty means no authentication. */
  security: ApiSecurityRequirement[];
  servers?: ApiServer[];
}

export interface ApiTag {
  name: string;
  description?: string;
}

export interface ApiModel {
  title: string;
  version?: string;
  description?: string;
  servers: ApiServer[];
  tags: ApiTag[];
  operations: ApiOperation[];
  /** Named schemas that are referenced from somewhere, by the name used in `ApiSchema.ref`. */
  schemas: Record<string, ApiSchema>;
  securitySchemes: Record<string, ApiSecurityScheme>;
}

/** What a generated endpoint page embeds: the operation plus what is needed to try it. */
export interface ApiOperationData {
  operation: ApiOperation;
  servers: ApiServer[];
  securitySchemes: Record<string, ApiSecurityScheme>;
  /** Do not show the playground. */
  noPlayground?: boolean;
}

/** An error in a spec or in reading it. The message names the source and says what is wrong. */
export class ApiSpecError extends Error {
  readonly source: string;
  constructor(source: string, reason: string) {
    super(`${source}: ${reason}`);
    this.name = 'ApiSpecError';
    this.source = source;
  }
}
