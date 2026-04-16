import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  createAuthenticatingFetchWithRetry,
  type AuthenticationHandler,
} from '@a2a-js/sdk/client';
import { useSettingsStore } from '../stores/settings';

// Declare Electron flag
declare const __IS_ELECTRON__: boolean;

// Validate and normalize URL
function validateUrl(url: string | null): string {
  const defaultUrl = 'http://localhost:10000';

  // If null, undefined, or empty, return default
  if (!url || url.trim() === '') {
    return defaultUrl;
  }

  const trimmedUrl = url.trim();

  // If it's just a path (like '/a2a'), return as-is (for dev mode proxy)
  if (trimmedUrl.startsWith('/')) {
    return trimmedUrl;
  }

  // Try to validate as full URL
  try {
    new URL(trimmedUrl);
    return trimmedUrl;
  } catch {
    // Invalid URL, return default
    console.warn(`Invalid agent URL: ${trimmedUrl}, using default: ${defaultUrl}`);
    return defaultUrl;
  }
}

// Get the base URL dynamically
function getBaseUrl(): string {
  // Always use the agent URL from localStorage (or default).
  // This works for both Electron and Web modes, dev and production.
  const url = localStorage.getItem('agent_url');
  return validateUrl(url);
}

/**
 * Extracts the origin (protocol + host + port) from a URL.
 * The A2A agent card is served at {origin}/.well-known/agent-card.json,
 * so we need just the origin, not the full endpoint path.
 */
function extractOrigin(url: string): string {
  // If it's a relative path (e.g. '/a2a'), return just the origin of the current page
  if (url.startsWith('/')) {
    return window.location.origin;
  }
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return url;
  }
}

/**
 * Creates an AuthenticationHandler that reads the active JWT token
 * from the settings store and injects it as a Bearer token.
 */
function createAuthHandler(): AuthenticationHandler {
  return {
    async headers(): Promise<Record<string, string>> {
      // Read the active token from the Pinia settings store
      const settingsStore = useSettingsStore();
      const token = settingsStore.authToken;
      if (token) {
        return { 'Authorization': `Bearer ${token}` };
      }
      return {};
    },
    async shouldRetryWithHeaders(_req: RequestInit, _res: Response) {
      // No automatic retry — user must regenerate token manually
      return undefined;
    },
  };
}

/**
 * Creates a ClientFactory with authentication support.
 * The authenticated fetch wrapper injects Bearer tokens into all requests.
 */
function createAuthenticatedFactory(): ClientFactory {
  const authHandler = createAuthHandler();
  const authFetch = createAuthenticatingFetchWithRetry(fetch, authHandler);

  return new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory({ fetchImpl: authFetch })],
      cardResolver: new DefaultAgentCardResolver({ fetchImpl: authFetch }),
    })
  );
}

// Export a function that returns the client promise with the current URL
export const getA2AClient = () => {
  const fullUrl = getBaseUrl();
  const origin = extractOrigin(fullUrl);
  console.log('Creating A2A client with URL:', origin);
  const factory = createAuthenticatedFactory();
  return factory.createFromUrl(origin);
};
