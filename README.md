<h1 align="center">Serendipity</h1>

<p align="center">
  <strong>The player website and staff interface for Illyaverse.</strong>
</p>

Serendipity brings accounts, profiles, beatmaps, rankings and community chat
into one website. It uses Next.js, React, TypeScript, Tailwind CSS, shadcn/ui
and next-intl. Sanctuary provides the API and storage; Resonance handles game
client protocols.

Source: [Illyavrs/Serendipity](https://github.com/Illyavrs/Serendipity) ·
Parent: [Illyavrs/Illyaverse](https://github.com/Illyavrs/Illyaverse).

## What is included

- Registration, account settings, session management and email recovery when
  the server has SMTP configured.
- Customizable player profiles, score and replay pages, Normal and Relax
  rankings, beatmap discovery, uploads and ranking requests.
- Public channels, private conversations, friends, blocking and staff tools
  controlled by server permissions.
- English, Traditional Chinese and Japanese; light/dark themes, configurable
  glass surfaces and self-hosted Nunito, TaiwanPearl and Zen Maru Gothic fonts.

Client verification and deployment status are tracked in the parent's
[current integration record](https://github.com/Illyavrs/Illyaverse/blob/main/docs/current-integration-20261010.md).

## Develop

Use Node.js **22 or newer** and a fully populated Illyaverse checkout. Run
these commands from the **parent root**, using its npm workspace and lockfile:

```sh
npm ci
npm run dev --workspace @illyaverse/serendipity
```

Open [http://localhost:3000](http://localhost:3000). The website forwards
`/api/v1` and `/media` to Sanctuary through `API_INTERNAL_URL`, which defaults
to `http://127.0.0.1:8080`. Start the backend and database using the parent's
[architecture guide](https://github.com/Illyavrs/Illyaverse/blob/main/docs/architecture.md).

```sh
npm run typecheck --workspace @illyaverse/serendipity
npm run lint --workspace @illyaverse/serendipity
npm run build --workspace @illyaverse/serendipity
```

## Integration

This repository owns the website source. The parent supplies workspace
manifests, the lockfile, shared schema, backend integration, deployment
configuration and integration tooling. Docker builds use its root as their context
and include its documentation. A standalone clone does not include those
shared inputs or a complete server environment.

Follow the parent's [deployment guide](https://github.com/Illyavrs/Illyaverse/blob/main/docs/deployment.md) for a complete
local or public server. See the [repository guide](https://github.com/Illyavrs/Illyaverse/blob/main/docs/repository-layout.md)
for submodule workflows and [DESIGN.md](https://github.com/Illyavrs/Illyaverse/blob/main/DESIGN.md) for the product design.

## License and contributions

Serendipity is licensed under the [MIT License](LICENSE). Fonts and other
bundled assets retain their own licenses and notices; preserve their files
and attribution as described in the parent's [font guide](https://github.com/Illyavrs/Illyaverse/blob/main/docs/fonts.md).

Implementations are original. Follow [AGENTS.md](AGENTS.md) and use scoped
Conventional Commits, such as `feat(serendipity): add profile editor`.
