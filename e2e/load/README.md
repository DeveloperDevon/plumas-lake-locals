# Load test (NFR-04)

NFR-04: "Design for 2,000 members, 50 concurrent users, 500 posts/day; no re-architecture
needed to reach 10,000 members", verified via "k6 load test before launch".

`feed-read.js` ramps to 50 virtual users hitting `/feed` and `/profile/:id` (the PRD's own
"feed and profile reads" example) against a running dev server, with a `p(95)<300ms` threshold
matching NFR-03's own API latency budget. It's unauthenticated (see the script's own comment for
why) - that still exercises real routing/session-lookup/DB round trips under concurrency, just
not the full authenticated page payload.

## Running it

No local k6 install needed - run it via Docker against the dev server already listening on
`localhost:3000`:

```bash
docker run --rm -i --network host grafana/k6 run - < feed-read.js
```

On Docker Desktop for Mac/Windows, `--network host` doesn't reach the host's localhost the same
way as on Linux - use `-e BASE_URL=http://host.docker.internal:3000` instead:

```bash
docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 grafana/k6 run - < feed-read.js
```
