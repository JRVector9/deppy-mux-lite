// Browser bootstrap for the cmux PWA. Uses the same Stack account/team and the
// same device registry read-model as the native iOS client, but accepts the
// browser cookie session instead of native bearer headers.

import { listRegisteredDevices, resolveDeviceRegistryTeam } from "../../../../services/device-registry";
import { unauthorized, verifyRequest } from "../../../../services/vms/auth";
import { jsonResponse, requestedVmTeamIdFromRequest } from "../../../../services/vms/routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, {
    requestedTeamId: requestedVmTeamIdFromRequest(request),
    allowCookie: true,
  });
  if (!user) return unauthorized();

  const team = resolveDeviceRegistryTeam(request, user);
  if (!team.ok) {
    return jsonResponse({ error: team.error }, 403);
  }

  const registry = await listRegisteredDevices(team.teamId);
  return jsonResponse({
    account: {
      userId: user.id,
      primaryEmail: user.primaryEmail,
      teamId: registry.teamId,
    },
    auth: {
      mode: "stack",
      browserCookie: true,
    },
    registry,
  });
}

