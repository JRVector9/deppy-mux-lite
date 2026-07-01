export const WEB_CONNECT_COMPATIBILITY_HEADER = "x-deppy-web-connect";
export const WEB_CONNECT_COMPATIBILITY_VALUE = "1";

export function webConnectResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(WEB_CONNECT_COMPATIBILITY_HEADER, WEB_CONNECT_COMPATIBILITY_VALUE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function webConnectJsonResponse(data: unknown, status = 200): Response {
  return webConnectResponse(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
