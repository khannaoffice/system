import type { Capability, Schema } from "../../../core/src/capabilities.ts"

export interface ModelContextLike {
  registerTool?: (tool: WebMcpTool) => unknown
  unregisterTool?: (name: string) => unknown
  provideContext?: (context: { tools: WebMcpTool[] }) => unknown
}

export interface WebMcpTool {
  name: string
  description: string
  inputSchema: Schema
  annotations?: { readOnlyHint?: boolean }
  execute: (input: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean }>
}

export interface Registration {
  supported: boolean
  registered: string[]
  dispose: () => void
}

export function findModelContext(scope: { navigator?: unknown; document?: unknown } = globalThis as never): ModelContextLike | null {
  const candidates = [(scope.navigator as { modelContext?: ModelContextLike } | undefined)?.modelContext, (scope.document as { modelContext?: ModelContextLike } | undefined)?.modelContext]
  return candidates.find((c): c is ModelContextLike => !!c && (typeof c.registerTool === "function" || typeof c.provideContext === "function")) ?? null
}

export function registerWebMcp(
  capabilities: Capability[],
  call: (capability: string, args: Record<string, unknown>) => Promise<unknown>,
  context: ModelContextLike | null = findModelContext(),
): Registration {
  if (!context) return { supported: false, registered: [], dispose() {} }
  const tools: WebMcpTool[] = capabilities
    .filter((c) => c.implemented)
    .map((c) => ({
      name: c.id,
      description: c.description,
      inputSchema: c.inputSchema,
      annotations: { readOnlyHint: c.effect === "read" },
      async execute(input) {
        const result = (await call(c.id, input)) as { status?: string }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result, isError: result?.status !== "ok" }
      },
    }))
  const done: string[] = []
  if (typeof context.registerTool === "function") {
    for (const tool of tools) {
      try { context.registerTool(tool); done.push(tool.name) } catch { }
    }
  } else if (typeof context.provideContext === "function") {
    context.provideContext({ tools })
    done.push(...tools.map((t) => t.name))
  }
  return {
    supported: true,
    registered: done,
    dispose() {
      if (typeof context.unregisterTool === "function") for (const name of done) { try { context.unregisterTool(name) } catch { } }
      else if (typeof context.provideContext === "function") context.provideContext({ tools: [] })
    },
  }
}
