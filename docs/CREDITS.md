# Credits — third-party software and assets

Raven is built on other people's work. This file records what we use, under which licence, and
what each thing is for. Nothing here may be removed from a distribution: several of these licences
require the notice to travel with the software.

The product goal document requires a **Credits / Open Source** surface inside the application.
The in-application page is `/legal/credits`, with self-hosted OFL notices for the active fonts. This file records the broader dependency context.

## Fonts

| Family         | Licence     | Where it is used                                               | Upstream                                   |
| -------------- | ----------- | -------------------------------------------------------------- | ------------------------------------------ |
| Inter Tight    | SIL OFL 1.1 | legacy builds; no longer loaded by the default UI              | https://github.com/rsms/inter              |
| Manrope        | SIL OFL 1.1 | headings and interface (`--nx-font-display`, `--nx-font-sans`) | https://github.com/sharanda/manrope        |
| JetBrains Mono | SIL OFL 1.1 | code, hashes, selectors (`--nx-font-mono`)                     | https://github.com/JetBrains/JetBrainsMono |

All three are self-hosted through Fontsource (`@fontsource-variable/*`), never fetched from a CDN:
the default build must work offline (N2). The OFL text ships inside each package under
`node_modules/@fontsource-variable/<family>/LICENSE` and is included in the distribution.

## Data sources and engines

Provider-level licences, attribution requirements and terms live in
`docs/ecosystem/PROVIDER_CATALOG.md` and in each provider manifest
(`packages/transforms/src/catalog/providers.ts`, field `licence` / `attribution`). The built-in
engines currently ship for: Google Public DNS (DoH), crt.sh certificate transparency search and
RDAP (RFC 9224) — all keyless public services used as documented.

## Libraries

Runtime and build dependencies are declared in the `package.json` of each workspace package and
pinned in `pnpm-lock.yaml`; security advisories are checked by the `audit` job in CI. Each dependency retains its own licence terms.
