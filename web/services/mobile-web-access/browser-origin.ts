import {
  hostIsLoopback,
  hostIsTailscaleAttachable,
} from "../../app/api/devices/route-classification";

export function webAccessBrowserMutationOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin")?.trim();
  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return false;
  }
  if (!origin) {
    return false;
  }
  try {
    const originURL = new URL(origin);
    const requestURL = new URL(request.url);
    if (originURL.origin === requestURL.origin) {
      return true;
    }
    return sameLocalTailnetEndpoint(originURL, requestURL);
  } catch {
    return false;
  }
}

function sameLocalTailnetEndpoint(originURL: URL, requestURL: URL): boolean {
  if (originURL.protocol !== requestURL.protocol) {
    return false;
  }
  if (originURL.port !== requestURL.port) {
    return false;
  }
  const originHost = originURL.hostname;
  const requestHost = requestURL.hostname;
  const originAllowed = hostIsLoopback(originHost) || hostIsTailscaleAttachable(originHost);
  const requestAllowed = hostIsLoopback(requestHost) || hostIsTailscaleAttachable(requestHost);
  return originAllowed && requestAllowed;
}
