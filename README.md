# Data Connector Agent for RisingWave

This repository contains a Hasura GraphQL Engine (v2) data connector Agent for RisingWave. It's based on the [SQLite data connector agent](https://github.com/hasura/graphql-engine/tree/master/dc-agents/sqlite) implementation provided by Hasura.

## Capabilities

The RisingWave agent currently supports the following capabilities:

- [x] GraphQL Schema
- [x] GraphQL Queries
- [x] Relationships
- [x] Aggregations
- [x] Native (Interpolated) Queries
- [x] RisingWave `STRUCT<>`s and arrays
- [ ] Exposing Foreign-Key Information (no foreign keys in RisingWave)
- [ ] Prometheus Metrics (needs testing)
- [ ] Mutations
- [ ] Subscriptions
- [ ] Streaming Subscriptions

Note: You are able to get detailed metadata about the agent's capabilities by
`GET`ting the `/capabilities` endpoint of the running agent.

## Requirements

- Bun
- Docker

## Build & Run

```sh
bun install
bun start
```

Or a dev loop with

```sh
bun start --watch
```

## Docker Build & Run

```
> docker build . -t dc-risingwave:latest
> docker run -it --rm -p 8100:8100 dc-risingwave:latest
```

You will want to mount a volume with your database(s) so that they can be referenced in configuration.

## Options / Environment Variables

Note: Boolean flags `{FLAG}` can be provided as `1`, `true`, `t`, `yes`, `y`, or omitted and default to `false`.

| ENV Variable Name   | Format                                                         | Default | Info                                                                             |
| ------------------- | -------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `PORT`              | `INT`                                                          | `8100`  | Port for agent to listen on.                                                     |
| `PERMISSIVE_CORS`   | `{FLAG}`                                                       | `false` | Allows all requests - Useful for testing with SwaggerUI. Turn off on production. |
| `DEBUGGING_TAGS`    | `{FLAG}`                                                       | `false` | Outputs xml style tags in query comments for deugging purposes.                  |
| `PRETTY_PRINT_LOGS` | `{FLAG}`                                                       | `false` | Uses `pino-pretty` to pretty print request logs                                  |
| `LOG_LEVEL`         | `fatal` \| `error` \| `info` \| `debug` \| `trace` \| `silent` | `info`  | The minimum log level to output                                                  |

## Agent usage

The agent is configured as per the configuration schema. The valid configuration properties are:

| Property | Type     | Default |
| -------- | -------- | ------- |
| `url`    | `string` |         |

The only required property is `url` which specifies the RisingWave databaes to use.

## Testing

Run the various services:

```sh
bun start
docker compose up -d # in a separate terminal
bun test
```

## TODO

- [ ] Prometheus metrics hosted at `/metrics`
