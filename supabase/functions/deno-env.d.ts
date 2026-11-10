// Ambient types for the only Deno APIs this repo's Edge Function entry points (`*/index.ts`) call,
// so `tsc` and ESLint check those files without Deno installed. Never imported at runtime; Deno
// supplies the real `Deno` namespace.
declare namespace Deno {
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;

  namespace env {
    function get(key: string): string | undefined;
  }
}
