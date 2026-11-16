import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routePolicies } from "../../core/policy-registry";
import {
  cmmsReferencesConfigured,
  readCmmsAssets,
  readCmmsProjectLocation,
  readCmmsPurchaseOptions,
  readCmmsSections,
  readCmmsSites,
} from "./references";

const endpoint = "https://cmms.example/api/v1/pscm/references";
const token = "example-reference-token";

describe("CMMS reference data", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CMMS_REFERENCE_API_URL", endpoint);
    vi.stubEnv("CMMS_REFERENCE_API_TOKEN", token);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does not activate until the reference endpoint and its token are configured", async () => {
    vi.stubEnv(
      "CATALOG_API_URL",
      "https://cmms.example/api/v1/catalog/pscm/items"
    );
    vi.stubEnv("CATALOG_API_TOKEN", "example-catalog-token");
    vi.stubEnv("CMMS_REFERENCE_API_URL", "");
    expect(cmmsReferencesConfigured()).toBe(false);
    await expect(readCmmsSites()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    vi.stubEnv("CMMS_REFERENCE_API_URL", endpoint);
    vi.stubEnv("CMMS_REFERENCE_API_TOKEN", "");
    expect(cmmsReferencesConfigured()).toBe(false);
    await expect(readCmmsSites()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects credentials embedded in a URL and requires HTTPS for production", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const url of [
      "http://127.0.0.1/references",
      "https://user:secret@cmms.example/references",
    ]) {
      vi.stubEnv("CMMS_REFERENCE_API_URL", url);
      expect(cmmsReferencesConfigured()).toBe(false);
    }
  });

  it("passes parent IDs and locale, keeping names and IDs from CMMS", async () => {
    const options = {
      categories: [{ id: 35, name: "صيانة" }],
      reviewRoles: [
        { code: "construction_procurement_manager", name: "الإنشاءات" },
      ],
    };
    const rows = [{ id: 12, name: "موقع التشغيل" }];
    fetchMock
      .mockResolvedValueOnce(
        Response.json([{ ...rows[0], token: "invalid-extra-field" }])
      )
      .mockResolvedValueOnce(Response.json(rows))
      .mockResolvedValueOnce(Response.json(rows))
      .mockResolvedValueOnce(Response.json(options));
    expect(cmmsReferencesConfigured()).toBe(true);
    expect(await readCmmsSites()).toEqual(rows);
    expect(await readCmmsSections(12, "en")).toEqual(rows);
    expect(await readCmmsAssets(12, 16, "ur")).toEqual(rows);
    expect(await readCmmsPurchaseOptions()).toEqual(options);
    const queries = fetchMock.mock.calls.map(([url, request]) => {
      expect(request).toMatchObject({
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
      });
      const parsed = new URL(String(url));
      expect(parsed.origin + parsed.pathname).toBe(endpoint);
      return Object.fromEntries(parsed.searchParams);
    });
    expect(queries).toEqual([
      { type: "sites", locale: "ar" },
      { type: "sections", locale: "en", siteId: "12" },
      { type: "assets", locale: "ur", siteId: "12", sectionId: "16" },
      { type: "purchaseOptions", locale: "ar" },
    ]);
  });

  it("rejects malformed, duplicate, non-JSON and oversized results", async () => {
    const item = { id: 9, name: "موقع" };
    fetchMock
      .mockResolvedValueOnce(Response.json([item, item]))
      .mockResolvedValueOnce(Response.json([{ ...item, id: "9" }]))
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        })
      )
      .mockResolvedValueOnce(
        new Response("[]", {
          headers: {
            "content-type": "application/json",
            "content-length": "1000001",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response('"' + "x".repeat(1_000_001) + '"', {
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          categories: [item],
          reviewRoles: [{ code: " ", name: "x" }],
        })
      );
    for (let call = 0; call < 5; call++) {
      await expect(readCmmsSites()).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
    }
    await expect(readCmmsPurchaseOptions()).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
  });

  it("checks only the selected location and omits the optional asset parameter", async () => {
    const site = { id: 12, name: "Operation site" };
    const section = { id: 16, name: "Facilities" };
    const asset = { id: 20, name: "Pump" };
    fetchMock
      .mockResolvedValueOnce(Response.json({ site, section, asset }))
      .mockResolvedValueOnce(Response.json({ site, section, asset: null }))
      .mockResolvedValueOnce(Response.json(null));

    await expect(readCmmsProjectLocation(12, 16, 20, "en")).resolves.toEqual({
      site,
      section,
      asset,
    });
    await expect(readCmmsProjectLocation(12, 16, null)).resolves.toEqual({
      site,
      section,
      asset: null,
    });
    await expect(readCmmsProjectLocation(12, 16, 99, "ur")).resolves.toBeNull();
    const queries = fetchMock.mock.calls.map(([url]) =>
      Object.fromEntries(new URL(String(url)).searchParams)
    );
    expect(queries).toEqual([
      {
        type: "projectLocation",
        locale: "en",
        siteId: "12",
        sectionId: "16",
        assetId: "20",
      },
      { type: "projectLocation", locale: "ar", siteId: "12", sectionId: "16" },
      {
        type: "projectLocation",
        locale: "ur",
        siteId: "12",
        sectionId: "16",
        assetId: "99",
      },
    ]);
  });

  it("reports upstream failures without leaking the endpoint, token or upstream response", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error(`${endpoint} ${token}`))
      .mockResolvedValueOnce(new Response(token, { status: 403 }))
      .mockRejectedValueOnce(new DOMException(token, "TimeoutError"));
    for (const [operation, diagnostic] of [
      [() => readCmmsSites(), "[sites · connection]"],
      [
        () => readCmmsProjectLocation(12, 16, 20),
        "[projectLocation · HTTP 403]",
      ],
      [() => readCmmsAssets(12, 16), "[assets · timeout]"],
    ] as const) {
      const error = await operation().catch((error: unknown) => error);
      expect(error).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        message: expect.stringContaining(diagnostic),
      });
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain(endpoint);
    }
  });
});

it("limits project and requisition reference procedures to their corresponding permissions", () => {
  for (const name of ["sites", "sections", "assets"]) {
    expect(routePolicies[`cmmsReferences.${name}`]).toEqual({
      any: ["pm.create", "pm.edit"],
    });
  }
  expect(routePolicies["cmmsReferences.purchaseOptions"]).toEqual({
    any: ["materialRequisitions.create", "materialRequisitions.approve"],
  });
  expect(routePolicies["cmmsReferences.status"]).toEqual({
    any: [
      "pm.create",
      "pm.edit",
      "materialRequisitions.create",
      "materialRequisitions.approve",
    ],
  });
});
