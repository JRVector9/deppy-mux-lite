export type MobilePwaBootstrapDevice = {
  deviceId: string;
  platform: string;
  displayName: string | null;
  labels: Record<string, unknown>;
  lastSeenAt: string;
  instances: Array<{
    tag: string;
    routes: unknown;
    labels: unknown;
    lastSeenAt: string;
  }>;
};

export type MobilePwaBootstrap = {
  account: {
    userId: string;
    primaryEmail: string | null;
    teamId: string;
  };
  auth: {
    mode: "stack";
    browserCookie: true;
  };
  registry: {
    teamId: string;
    devices: MobilePwaBootstrapDevice[];
  };
};

export type MobilePwaBootstrapResult =
  | { ok: true; value: MobilePwaBootstrap }
  | { ok: false; error: "unauthorized" | "unavailable" };

export async function fetchMobilePwaBootstrap(
  teamId?: string,
): Promise<MobilePwaBootstrapResult> {
  const url = new URL("/api/mobile/bootstrap", window.location.origin);
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }

  const response = await fetch(url, {
    credentials: "include",
    headers: { accept: "application/json" },
  });

  if (response.status === 401) {
    return { ok: false, error: "unauthorized" };
  }
  if (!response.ok) {
    return { ok: false, error: "unavailable" };
  }

  return { ok: true, value: (await response.json()) as MobilePwaBootstrap };
}

