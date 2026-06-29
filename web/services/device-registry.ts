import { desc, eq } from "drizzle-orm";
import { cloudDb } from "../db/client";
import { deviceAppInstances, devices } from "../db/schema";
import type { AuthedUser } from "./vms/auth";
import { requestedVmTeamIdFromRequest } from "./vms/routeHelpers";

export type DeviceRegistryTeamResolution =
  | { ok: true; teamId: string }
  | { ok: false; error: "team_not_found" };

export type DeviceRegistryInstance = {
  tag: string;
  routes: unknown;
  labels: unknown;
  lastSeenAt: string;
};

export type DeviceRegistryDevice = {
  deviceId: string;
  platform: string;
  displayName: string | null;
  labels: Record<string, unknown>;
  lastSeenAt: string;
  instances: DeviceRegistryInstance[];
};

export type DeviceRegistryList = {
  teamId: string;
  devices: DeviceRegistryDevice[];
};

type DeviceListRow = {
  id: string;
  deviceUuid: string;
  platform: string;
  displayName: string | null;
  labels: Record<string, unknown>;
  lastSeenAt: Date;
};

/**
 * Resolve the team this request operates on and reject teams the caller is not a
 * member of. A requested team (`X-Cmux-Team-Id` / `?teamId=`) must appear in the
 * caller's verified team list; with no request team we default to the caller's
 * selected team, then the billing team.
 */
export function resolveDeviceRegistryTeam(
  request: Request,
  user: AuthedUser,
): DeviceRegistryTeamResolution {
  const requested = requestedVmTeamIdFromRequest(request);
  if (requested) {
    const isMember = user.teamIds.includes(requested) || requested === user.id;
    if (!isMember) {
      return { ok: false, error: "team_not_found" };
    }
    return { ok: true, teamId: requested };
  }
  return { ok: true, teamId: user.selectedTeamId ?? user.billingTeamId };
}

/**
 * List the team's registered devices and their app instances, so mobile clients
 * can find a previously paired Mac and refresh its advertised routes on reload.
 */
export async function listRegisteredDevices(
  teamId: string,
): Promise<DeviceRegistryList> {
  const db = cloudDb();

  const deviceRows = (await db
    .select({
      id: devices.id,
      deviceUuid: devices.deviceUuid,
      platform: devices.platform,
      displayName: devices.displayName,
      labels: devices.labels,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .where(eq(devices.teamId, teamId))
    .orderBy(desc(devices.lastSeenAt))) as DeviceListRow[];

  const instanceRows = await db
    .select({
      deviceId: deviceAppInstances.deviceId,
      tag: deviceAppInstances.tag,
      routes: deviceAppInstances.routes,
      labels: deviceAppInstances.labels,
      lastSeenAt: deviceAppInstances.lastSeenAt,
    })
    .from(deviceAppInstances)
    .where(eq(deviceAppInstances.teamId, teamId))
    .orderBy(desc(deviceAppInstances.lastSeenAt));

  const instancesByDevice = new Map<string, typeof instanceRows>();
  for (const row of instanceRows) {
    const list = instancesByDevice.get(row.deviceId) ?? [];
    list.push(row);
    instancesByDevice.set(row.deviceId, list);
  }

  const devicesPayload = deviceRows.map((device) => ({
    // Mobile clients match their stored macDeviceID against this cmux device
    // UUID, not the registry table's internal surrogate row id.
    deviceId: device.deviceUuid,
    platform: device.platform,
    displayName: device.displayName,
    labels: device.labels,
    lastSeenAt: device.lastSeenAt.toISOString(),
    instances: (instancesByDevice.get(device.id) ?? []).map((instance) => ({
      tag: instance.tag,
      routes: instance.routes,
      labels: instance.labels,
      lastSeenAt: instance.lastSeenAt.toISOString(),
    })),
  }));

  return { teamId, devices: devicesPayload };
}

