import { createServer, type Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  catalogConfigurationStatus,
  fetchCatalogItems,
  searchCatalog,
} from "./catalog-provider";
import {
  catalogImageMime,
  fetchCatalogImage,
  persistCatalogImage,
} from "./catalog-media";
import { storeDocument } from "../../storage";

vi.mock("../../storage", () => ({
  storeDocument: vi.fn(async () => ({
    key: "local/11111111-1111-4111-8111-111111111111",
    url: "/documents/files/local/11111111-1111-4111-8111-111111111111",
  })),
}));

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=",
  "base64"
);
const item = {
  id: "item,001",
  code: "000123-A",
  name: "دهان إيبوكسي",
  specifications: "رمادي",
  unit: {
    id: "unit01",
    code: "L",
    nameAr: "لتر",
    nameEn: "Litre",
    nameUr: "لیٹر",
  },
  imageUrl: null,
};
describe("External catalog connector", () => {
  let server: Server,
    endpoint = "",
    mode = "normal",
    calls = 0;
  let lastRequest: { authorization?: string; search?: URLSearchParams } = {};
  beforeAll(async () => {
    server = createServer((req, res) => {
      calls++;
      const url = new URL(req.url!, endpoint);
      lastRequest = {
        authorization: req.headers.authorization,
        search: url.searchParams,
      };
      if (url.pathname === "/image") {
        res.setHeader("Content-Type", "image/png");
        res.end(png);
        return;
      }
      if (url.pathname === "/svg") {
        res.setHeader("Content-Type", "image/png");
        res.end(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        );
        return;
      }
      if (url.pathname === "/huge-image") {
        res.setHeader("Content-Length", "5000001");
        res.end();
        return;
      }
      if (mode === "redirect") {
        res.writeHead(302, { Location: endpoint + "/redirected" });
        res.end();
        return;
      }
      if (mode === "huge") {
        res.setHeader("Content-Length", "1000001");
        res.end();
        return;
      }
      if (mode === "html") {
        res.setHeader("Content-Type", "text/html");
        res.end("<html>not JSON</html>");
        return;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const requestedIds = url.searchParams.get("ids");
      let rows = requestedIds
        ? (JSON.parse(requestedIds) as string[]).map(id => ({ ...item, id }))
        : [item];
      if (mode === "duplicate") rows = [item, item];
      if (mode === "wrong-id") rows = [{ ...item, id: "not-requested" }];
      res.end(
        JSON.stringify({
          items: rows,
          total: rows.length,
          page: Number(url.searchParams.get("page") || 1),
          pageSize: Number(url.searchParams.get("pageSize") || 20),
        })
      );
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Fixture failed");
    endpoint = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => {
    mode = "normal";
    calls = 0;
    vi.stubEnv("CATALOG_API_URL", endpoint + "/catalog");
    vi.stubEnv("CATALOG_API_TOKEN", "test-secret-do-not-expose");
    vi.stubEnv("CATALOG_IMAGE_ALLOWED_ORIGINS", "");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  });
  it("requires configuration without fabricated catalog data", async () => {
    vi.stubEnv("CATALOG_API_URL", "");
    expect(catalogConfigurationStatus()).toEqual({ configured: false });
    await expect(searchCatalog({})).rejects.toThrow(/not configured/);
    expect(calls).toBe(0);
  });
  it("forwards search/page/language on the server and preserves catalog codes with units", async () => {
    expect(catalogConfigurationStatus()).toEqual({ configured: true });
    const result = await searchCatalog({
      q: "إيبوكسي",
      page: 2,
      pageSize: 10,
      locale: "ur",
    });
    expect(lastRequest.search?.get("q")).toBe("إيبوكسي");
    expect(lastRequest.search?.get("locale")).toBe("ur");
    expect(lastRequest.authorization).toBe("Bearer test-secret-do-not-expose");
    expect(result.items[0].code).toBe("000123-A");
    expect(result.items[0].unit.code).toBe("L");
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
  it("re-reads selected identities authoritatively and rejects missing/duplicate identities", async () => {
    const selected = await fetchCatalogItems(["item,001", "another"], "ur");
    expect(lastRequest.search?.get("locale")).toBe("ur");
    expect(lastRequest.search?.get("ids")).toBe('["item,001","another"]');
    expect(selected.map(row => row.id)).toEqual(["item,001", "another"]);
    mode = "wrong-id";
    await expect(fetchCatalogItems(["item,001"])).rejects.toThrow(
      /does not match/
    );
    mode = "duplicate";
    await expect(searchCatalog({})).rejects.toThrow(/does not match/);
    await expect(fetchCatalogItems(["item,001", "item,001"])).rejects.toThrow();
  });
  it("does not follow redirects or read oversized/non-JSON responses", async () => {
    mode = "redirect";
    await expect(searchCatalog({})).rejects.toThrow(/unavailable/);
    expect(calls).toBe(1);
    mode = "huge";
    await expect(searchCatalog({})).rejects.toThrow(/unavailable/);
    mode = "html";
    await expect(searchCatalog({})).rejects.toThrow(/does not match/);
  });
  it("captures validated raster bytes into immutable storage", async () => {
    const image = await fetchCatalogImage(endpoint + "/image");
    expect(image.mimeType).toBe("image/png");
    expect(image.content).toEqual(png);
    const captured = await persistCatalogImage(endpoint + "/image");
    expect(storeDocument).toHaveBeenCalledWith(png);
    expect(captured.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(captured.sizeBytes).toBe(png.length);
    expect(captured.key).toContain("local/");
  });
  it("rejects SVG payloads, oversized images and untrusted/private image origins", async () => {
    await expect(fetchCatalogImage(endpoint + "/svg")).rejects.toThrow(
      /could not be imported/
    );
    await expect(fetchCatalogImage(endpoint + "/huge-image")).rejects.toThrow(
      /could not be imported/
    );
    await expect(
      fetchCatalogImage("https://not-allowed.example/image.png")
    ).rejects.toThrow(/could not be imported/);
    vi.stubEnv("CATALOG_IMAGE_ALLOWED_ORIGINS", "https://127.0.0.1");
    await expect(
      fetchCatalogImage("https://127.0.0.1/image.png")
    ).rejects.toThrow(/could not be imported/);
    expect(catalogImageMime(Buffer.from("<svg/>"))).toBe(null);
  });
});
