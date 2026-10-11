'use client';

import { useEffect } from 'react';
import { type AskScope, setAskScope } from '../lib/scope.ts';

/** Tells the assistant and "Take me there" which version and language the reader is in. Renders nothing. */
export function AskScopeSetter({ locale, version }: AskScope) {
  useEffect(() => {
    setAskScope({ locale, version });
  }, [locale, version]);
  return null;
}
