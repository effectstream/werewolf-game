# Build & Run

```sh
deno install
./patch
deno task -f @werewolf-game/evm-contracts build:mod
deno task -f "@example-midnight/my-midnight-contract" compact
deno task dev
```