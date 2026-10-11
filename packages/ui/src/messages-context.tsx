'use client';

import { type MessageKey, type Messages, en, format } from '@dockudos/core';
import { type ReactNode, createContext, useCallback, useContext } from 'react';

const MessagesContext = createContext<Messages>(en);

/** Gives the interface its words in the page's language. Rendered by `DocsLayout`. */
export function MessagesProvider({
  messages,
  children,
}: {
  messages: Messages;
  children: ReactNode;
}) {
  return (
    <MessagesContext.Provider value={messages}>
      {children}
    </MessagesContext.Provider>
  );
}

/** A function that returns a message of the interface in the page's language, with `{name}` values filled in. */
export function useMessages(): (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string {
  const messages = useContext(MessagesContext);
  return useCallback(
    (key, values) => format(messages[key] ?? en[key], values),
    [messages],
  );
}
