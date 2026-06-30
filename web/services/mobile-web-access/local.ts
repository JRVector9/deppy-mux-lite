import {
  createMemoryWebAccessSessionRepository,
  type WebAccessSessionRepository,
} from "./sessions";
import {
  createMemoryWebAccessRelayRepositoryForSessions,
  type WebAccessRelayRepository,
} from "./relay";

type LocalWebAccessState = {
  sessions: WebAccessSessionRepository;
  relay: WebAccessRelayRepository;
};

const globalForLocalWebAccess = globalThis as typeof globalThis & {
  __cmuxLocalWebAccess?: LocalWebAccessState;
};

function localState(): LocalWebAccessState {
  if (globalForLocalWebAccess.__cmuxLocalWebAccess) {
    return globalForLocalWebAccess.__cmuxLocalWebAccess;
  }
  const sessions = createMemoryWebAccessSessionRepository();
  const relay = createMemoryWebAccessRelayRepositoryForSessions(sessions);
  const state = { sessions, relay };
  globalForLocalWebAccess.__cmuxLocalWebAccess = state;
  return state;
}

export function localWebAccessEnabled(): boolean {
  return process.env.CMUX_WEB_CONNECT_LOCAL_ONLY === "1";
}

export function localWebAccessControlTokenAllowed(request: Request): boolean {
  const expected = process.env.CMUX_WEB_CONNECT_LOCAL_TOKEN?.trim();
  if (!expected) {
    return false;
  }
  const actual = request.headers.get("x-deppy-web-connect-local-token")?.trim();
  return actual === expected;
}

export function webAccessSessionRepository(): WebAccessSessionRepository | undefined {
  return localWebAccessEnabled() ? localState().sessions : undefined;
}

export function webAccessRelayRepository(): WebAccessRelayRepository | undefined {
  return localWebAccessEnabled() ? localState().relay : undefined;
}
