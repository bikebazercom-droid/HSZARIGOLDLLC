---
name: Purchase-bill location QR
description: Records why the individual purchase-bill PDF uses a bundled location QR and when it must be regenerated.
---

The invoice-style purchase-bill PDF uses a bundled QR image for Hazari Gold's official Google Maps search location rather than generating a QR from company settings at request time.

**Why:** The API service has no runtime QR encoder, and adding a workspace-scoped dependency was not supported by the available package installer. A generated image keeps downloads reliable without a fake QR or an external network call.

**How to apply:** If the official business location changes, regenerate the bundled QR asset from the new location URL. Do not assume that changing the company `locationUrl` setting automatically updates purchase-bill PDFs.