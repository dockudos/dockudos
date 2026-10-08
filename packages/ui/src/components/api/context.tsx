'use client';

import type { ApiOperationData, SampleLanguage } from '@dockudos/core';
import { defaultSampleLanguages } from '@dockudos/core';
import { type ReactNode, createContext, useContext } from 'react';

interface ApiContext {
  data: ApiOperationData;
  /** Where the schemas that are loaded on demand are served from. */
  schemasUrl: string;
  /** Send playground requests through the site's proxy route. */
  proxy: boolean;
  languages: readonly SampleLanguage[];
}

const Context = createContext<ApiContext | undefined>(undefined);

export function useApiOperation(): ApiContext {
  const value = useContext(Context);
  if (!value) {
    throw new Error(
      'This component belongs inside <ApiOperation>, which the generated endpoint pages provide.',
    );
  }
  return value;
}

export interface ApiOperationProps {
  /** The operation and what is needed to try it (written by `dockudos generate`). */
  data: ApiOperationData;
  /** Folder URL of the schema files. */
  schemasUrl: string;
  /** Send playground requests through the proxy route of the site. */
  proxy?: boolean;
  /** Code sample languages. Default: cURL, JavaScript, Python, Go. */
  languages?: readonly SampleLanguage[];
  children?: ReactNode;
}

/** The root of a generated endpoint page: the parts inside it (`ApiParameters`, `ApiPlayground`, ...) read from it. */
export function ApiOperation({
  data,
  schemasUrl,
  proxy = false,
  languages = defaultSampleLanguages,
  children,
}: ApiOperationProps) {
  return (
    <Context value={{ data, schemasUrl, proxy, languages }}>
      <div className="dk-api" data-method={data.operation.method}>
        {data.operation.deprecated && (
          <p className="dk-api-deprecated" role="note">
            This endpoint is deprecated.
          </p>
        )}
        {children}
      </div>
    </Context>
  );
}
