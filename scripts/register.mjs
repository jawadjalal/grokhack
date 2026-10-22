// Lets `node --import ./scripts/register.mjs scripts/x.ts` run our TypeScript
// with Node's built-in type stripping: resolves extensionless relative imports
// to .ts, the @/ alias to the repo root, and JSON imports (lib/seed.ts imports
// data/london.json the bundler way) as JSON. No extra dependencies.
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = pathToFileURL(process.cwd() + '/').href

function asJson(result) {
  return result.url.endsWith('.json') ? { ...result, importAttributes: { ...result.importAttributes, type: 'json' } } : result
}

registerHooks({
  resolve(specifier, context, next) {
    const spec = specifier.startsWith('@/') ? new URL(specifier.slice(2), root).href : specifier
    if (spec.startsWith('.') || spec.startsWith('file:')) {
      for (const candidate of [spec, `${spec}.ts`, `${spec}/index.ts`]) {
        try {
          return asJson(next(candidate, context))
        } catch {}
      }
    }
    return asJson(next(spec, context))
  },
})
