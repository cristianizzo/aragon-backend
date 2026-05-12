![Aragon](https://res.cloudinary.com/dbktgy3vg/image/upload/v1689668058/aragon-app_hpima1.png)

<p align="center">
  <a href="https://aragon.org/">Aragon website</a>
  •
  <a href="https://devs.aragon.org/">Developer Portal</a>
  •
  <a href="https://aragonproject.typeform.com/to/LngekEhU">Join our Developer Community</a>
  •
  <a href="https://aragonproject.typeform.com/dx-contribution">Contribute</a>
</p>
<br/>

## Aragon Indexer

The Aragon Indexer is the next-generation indexing layer for the Aragon ecosystem, built on
[Envio HyperIndex](https://envio.dev). It indexes events emitted by Aragon smart contracts across
every supported network and exposes the data through a GraphQL API for the Aragon App and external
applications. It is the successor to the legacy MongoDB-based [app-backend](https://github.com/aragon/app-backend)
indexer service, with full field-level parity across every governance type (Multisig, TokenVoting,
Admin, LockToVote, VE / Gauge, Staged Proposal Processor, Capital Distributor) and per-chain
provider routing for explorers, RPC nodes, and rate limiting.

## Prerequisites

- [Node.js v22+ (v24 recommended)](https://nodejs.org/en/download/current) — pinned by `engines.node` in `package.json`
- [pnpm v8+](https://pnpm.io/installation) — package manager (do not use npm/yarn)
- [Docker](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/) — for the local Postgres + Hasura stack
- IDE of your choice (e.g. [WebStorm](https://www.jetbrains.com/webstorm/download) or [VS Code](https://code.visualstudio.com/))

## Getting Started

#### Clone repository

```sh
git clone https://github.com/aragon/aragon-indexer.git
cd aragon-indexer
```

#### Install dependencies

```sh
pnpm install
```

#### Environment

Copy `.env.example` to `.env` and fill in the API keys you need. The most impactful are:

| Var | Purpose |
|---|---|
| `NODES_DRPC_API_KEY` | RPC provider (preferred) |
| `NODES_ALCHEMY_API_KEY` | RPC fallback |
| `ETHERSCAN_API_KEY` | Action-decoder source-code lookup (Etherscan v2 multi-chain) |
| `ENVIO_IPFS_GATEWAY_URL` / `PINATA_GATEWAY_URI` | IPFS metadata gateways (optional) |
| `SUBSCAN_API_KEY` | Required only when indexing Peaq |

Without RPC and Etherscan keys the indexer still runs but will rate-limit hard against public
endpoints and lose ABI-based action decoding.

#### Generate code from `config.yaml` / `schema.graphql`

```sh
pnpm codegen
```

Run this whenever you change `config.yaml` or `schema.graphql`.

## Run locally

```sh
pnpm dev
```

The indexer starts the local Postgres + Hasura stack and begins syncing the chains configured in
`config.yaml`. The GraphQL Playground is available at [http://localhost:8080](http://localhost:8080)
(local password: `testing`).

For AI-friendly / non-TTY output (CI, logs, scripted runs), set `TUI_OFF=true`:

```sh
TUI_OFF=true pnpm dev
```

#### Inspect sync progress

```sh
pnpm status
```

Prints the per-chain progress block, source block, events processed, and ready timestamp.

## Tests

- Format all files

```sh
pnpm format
```

- Lint the code

```sh
pnpm lint
```

- Auto-fix lint

```sh
pnpm lint:fix
```

- Type-check

```sh
pnpm typecheck
```

- Unit + integration tests (Vitest, against a local Envio test indexer)

```sh
pnpm test
```

## Deployment

The indexer auto-deploys to [Envio Hosted Service](https://envio.dev) on every push to the
configured active branch (currently `main` on the official `aragon/aragon-indexer` repo).
Configure environment variables in the Envio dashboard before triggering the first deploy
(see the **Environment** section above for the required keys).

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like
to change.

Please make sure to update tests and run `pnpm codegen`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`
before opening a PR.

## Security

If you believe you've found a security issue, we encourage you to notify us. We welcome working with you
to resolve the issue promptly.

Security Contact Email: sirt@aragon.org

Please do not use the issue tracker for security issues.

## Learn More

For more information about Aragon and its ecosystem, please visit the [Aragon website](https://aragon.org/)
and explore our [Developer Portal](https://devs.aragon.org/).

Join our [Developer Community](https://aragonproject.typeform.com/to/LngekEhU) to stay updated and
contribute to the growth of decentralized governance.

For Envio HyperIndex documentation see [docs.envio.dev](https://docs.envio.dev).

## License

[GNU AGPLv3](./LICENSE)
