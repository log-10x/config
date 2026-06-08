## 1️⃣0️⃣❎ MCP Aggregator config

Aggregator unit configuration for the `@apps/mcp` and `@apps/mcp-file`
test-drive apps. Forked from `pipelines/run/aggregate/dev` to add a
periodic `flushInterval` so TenXSummary instances flow continuously
through the MCP wrapper rather than only on engine shutdown.

To learn more see the [Aggregator](https://doc.log10x.com/run/aggregate "Aggregate and summarize TenXObjects to publish as metrics") unit documentation

