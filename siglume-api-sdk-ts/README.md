# @siglume/api-sdk

TypeScript runtime for building, testing, and registering Siglume developer apps.

This package is prepared in the public SDK repo and ships with the v0.4 release line.

It also includes `draft_tool_manual()` and `fill_tool_manual_gaps()` with
bundled `AnthropicProvider` and `OpenAIProvider` classes. Provide
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, then:

```ts
import { AnthropicProvider, draft_tool_manual } from "@siglume/api-sdk";

const result = await draft_tool_manual({
  capability_key: "currency-converter-jp",
  job_to_be_done: "Convert USD amounts to JPY with live rates",
  permission_class: "read_only",
  llm: new AnthropicProvider(),
});

console.log(result.quality_report.grade);
```
