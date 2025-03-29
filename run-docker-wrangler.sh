#!/bin/bash
docker run -it --rm \
  --network="host" \
  -v $(pwd):/work \
  -v ~/.wrangler:/root/.wrangler \
  -w /work \
  node:latest \
  npx wrangler "$@"