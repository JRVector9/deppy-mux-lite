import { describe, expect, test } from "bun:test";
import {
  readBoundedJsonObject,
  readOptionalBoundedJsonObject,
} from "../services/http/bounded-json";

describe("bounded JSON body reader", () => {
  test("accepts body-less optional JSON requests as an empty object", async () => {
    const request = new Request("https://cmux.test/api/mobile/web-access/sessions", {
      method: "POST",
    });

    await expect(readOptionalBoundedJsonObject(request, 1024)).resolves.toEqual({
      ok: true,
      value: {},
    });
  });

  test("rejects body-less required JSON requests", async () => {
    const request = new Request("https://cmux.test/api/mobile/web-access/sessions/slug/rpc", {
      method: "POST",
    });

    await expect(readBoundedJsonObject(request, 1024)).resolves.toEqual({
      ok: false,
      status: 400,
    });
  });
});
