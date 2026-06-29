export type BoundedJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: number };

export async function readBoundedJsonObject(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  return readJsonObject(request, maxBytes, false);
}

export async function readOptionalBoundedJsonObject(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  return readJsonObject(request, maxBytes, true);
}

async function readJsonObject(
  request: Request,
  maxBytes: number,
  allowEmpty: boolean,
): Promise<BoundedJsonResult> {
  const lengthHeader = request.headers.get("content-length");
  if (allowEmpty && lengthHeader && Number(lengthHeader) === 0) {
    return { ok: true, value: {} };
  }
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    return { ok: false, status: 413 };
  }

  const raw = await readBoundedText(request, maxBytes, allowEmpty);
  if (!raw.ok) {
    return { ok: false, status: raw.status };
  }
  if (allowEmpty && raw.value.length === 0) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = JSON.parse(raw.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400 };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400 };
  }
}

async function readBoundedText(
  request: Request,
  maxBytes: number,
  allowEmpty: boolean,
): Promise<{ ok: true; value: string } | { ok: false; status: number }> {
  if (!request.body) {
    if (allowEmpty) {
      return { ok: true, value: "" };
    }
    return { ok: false, status: 400 };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, status: 413 };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, status: 400 };
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(body) };
}
