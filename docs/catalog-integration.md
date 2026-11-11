# External catalog integration

PSCM imports catalog identities, Catalog Code, name, unit, specifications and image together. The external system remains the source of these identities. Configure the server using `.env.example.catalog`; there is no demonstration catalog or implicit external endpoint.

## Configuration

- `CATALOG_API_URL`: full items API endpoint, for example `https://purchasing.example/api/catalog/items`.
- `CATALOG_API_TOKEN`: optional Bearer token sent only to the configured API origin. Keep it in server environment variables or Railway Variables.
- `CATALOG_IMAGE_ALLOWED_ORIGINS`: comma-separated additional HTTPS image origins, such as `https://cdn.purchasing.example`. The API origin is already allowed. These values are origins, not file paths.

Use HTTPS for a deployed external system. Explicit internal/development API origins can use HTTP. API tokens and endpoint settings are not returned in configuration status or user errors. Existing PSCM S3/local file-storage settings are reused for captured image copies.

## API contract

Search uses a `GET` request to the configured endpoint with `q`, `page`, `pageSize` and `locale` (`ar`, `en`, `ur`). No external write occurs during catalog search/import.

```json
{
  "items": [
    {
      "id": "item-83",
      "code": "000123-A",
      "name": "Epoxy coating",
      "specifications": "Grey, two-component",
      "unit": {
        "id": "unit-litre",
        "code": "L",
        "nameAr": "لتر",
        "nameEn": "Litre",
        "nameUr": "لیٹر"
      },
      "imageUrl": "https://cdn.purchasing.example/items/83.png"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

Item IDs and Catalog Codes are strings. Leading zeros in codes are preserved. `specifications` may be omitted and defaults to an empty string. `imageUrl` may be null/omitted when the external catalog has no image. All other illustrated item fields are required, except `unit.id`.

On selection, PSCM requests authoritative item data again using the same endpoint and `ids` as a URL-encoded JSON string array, with `page=1`, `pageSize` equal to the selected count and `locale` matching the search language (default `ar`). For example `ids=["item-83","item-91"]&locale=ur`. The response has the same envelope and must contain exactly the requested unique IDs, up to 20. This avoids accepting browser-supplied names, codes or units. A provider with a different native API needs an adapter to this contract before activation.

## Images and official requests

Images are fetched through the PSCM server, not with external API credentials in the browser. Only PNG, JPEG, GIF and WebP signatures are accepted. SVG and non-image payloads are rejected. Images are limited to 5 MB; catalog JSON responses to 1 MB. Requests time out after 12 seconds and never follow redirects. A catalog-provided URL cannot add itself to the trusted-origin list.

Images from a separately allowlisted image origin must resolve to public addresses; the selected address is pinned for the request. The explicitly configured API origin is treated as trusted, including internal origins. API authorization headers are never forwarded to a different image origin.

Import captures an immutable storage object with a checksum. Saved requisition items reference that copy; approval retains the captured code, unit and image in the official snapshot. A later edit of the external catalog cannot silently alter an official PSCM request. If the catalog provides an image URL but its import fails, the import fails with an actionable message rather than discarding the image.

The live connection requires the external endpoint, authentication details and a matching API response. Adding these settings does not automatically activate outbound purchasing or create purchase requests in the external system.
