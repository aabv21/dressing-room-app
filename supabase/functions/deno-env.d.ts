// Ambient types for the Deno APIs the `*/index.ts` entry points call, so `tsc` and ESLint check them
// without Deno installed. Never imported at runtime.
declare namespace Deno {
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;

  namespace env {
    function get(key: string): string | undefined;
  }
}
