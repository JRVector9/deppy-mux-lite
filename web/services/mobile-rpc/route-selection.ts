import type { MobilePwaBootstrapDevice } from "./bootstrap";

export type MobileAttachEndpoint = {
  deviceId: string;
  tag: string;
  routeId?: string;
  kind: string;
  url: string;
};

type WebsocketURLRoute = {
  id?: unknown;
  kind?: unknown;
  priority?: unknown;
  endpoint?: {
    type?: unknown;
    url?: unknown;
  };
};

/**
 * Pick browser-dialable mobile RPC endpoints from shared attach-route records.
 * The shared mobile contract represents WebSocket routes as `kind=websocket`
 * with an `endpoint.type=url` payload; native host-port routes are not browser
 * RPC endpoints.
 */
export function browserAttachEndpoints(
  devices: readonly MobilePwaBootstrapDevice[],
): MobileAttachEndpoint[] {
  const endpoints: MobileAttachEndpoint[] = [];

  for (const device of devices) {
    for (const instance of device.instances) {
      const routes = Array.isArray(instance.routes) ? instance.routes : [];
      const rankedRoutes = routes
        .map(asWebsocketURLRoute)
        .filter((route): route is WebsocketURLRoute => !!route)
        .sort((lhs, rhs) => routePriority(lhs) - routePriority(rhs));

      for (const route of rankedRoutes) {
        const url = route.endpoint?.url;
        const kind = route.kind;
        if (
          typeof url !== "string" ||
          typeof kind !== "string" ||
          kind !== "websocket" ||
          route.endpoint?.type !== "url" ||
          !isWebsocketURL(url)
        ) {
          continue;
        }
        endpoints.push({
          deviceId: device.deviceId,
          tag: instance.tag,
          routeId: typeof route.id === "string" ? route.id : undefined,
          kind,
          url,
        });
      }
    }
  }

  return endpoints;
}

function asWebsocketURLRoute(value: unknown): WebsocketURLRoute | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const route = value as WebsocketURLRoute;
  const endpoint = route.endpoint;
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
    return null;
  }
  return route;
}

function routePriority(route: WebsocketURLRoute): number {
  return typeof route.priority === "number" ? route.priority : Number.MAX_SAFE_INTEGER;
}

function isWebsocketURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
}
