---
title: "@apps/mcp"
description: "Internal stdin/stdout runtime invoked by resolve_batch and poc_from_siem_submit in privacy mode"
icon: material/console-line
hidden: true
---

`@apps/mcp` is a stdin/stdout-only variant of [`@apps/dev`](https://doc.log10x.com/apps/dev/). Every I/O channel that Dev routes through the filesystem (input directory, output directory, dev browser) is replaced here by the process's stdin/stdout. Pipe log lines in, get structured `TenXObject`s + `TenXTemplate`s on stdout, no disk access.

## Which tools invoke this

The MCP Server's [`log10x_resolve_batch`](../../manage/mcp-server/tools/resolve-batch.md) and [`log10x_poc_from_siem_submit`](../../manage/mcp-server/tools/poc-from-siem-submit.md) tools both default to `privacy_mode: true`, which shells out to a locally-installed `tenx` CLI running `@apps/mcp`. Events stay on the operator's machine — the MCP server never sends raw log content to Log10x.

- **`log10x_resolve_batch`** — when an agent triages a pasted batch of events
- **`log10x_poc_from_siem_submit`** — when an agent runs a full POC pulling events from your SIEM

Both tools error cleanly with an install hint if `tenx` isn't on `$PATH`: `brew install log10x/tap/tenx`.

## Reproduce a privacy-mode run locally

Pipe the same event text the MCP tool piped:

```bash
echo "<your log line>" | tenx @apps/mcp
```

Stack a candidate config after the base app to validate it:

```bash
echo "<your log line>" | tenx @apps/mcp @/path/to/your-config.yaml
```

Stdout is exactly what the MCP subprocess produced. Useful when an agent-returned summary surprises you and you want to see the raw engine output — diff against the agent's report to find where they diverged.

## Why narrower than `@apps/dev`

`@apps/mcp` omits `httpCode` and `lookup` enrichment. Their scripts reference engine builtins that move between releases, and keeping the MCP templating runtime pinned to stable primitives means privacy-mode MCP calls behave consistently across engine upgrades.

For local exploration where you want the full pipeline — HTTP code classification, lookup tables, the dev browser — use [Dev](https://doc.log10x.com/apps/dev/) directly instead of `@apps/mcp`.
