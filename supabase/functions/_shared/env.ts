// The Edge Functions' environment, read once when each `index.ts` loads: the runtime injects the
// `SUPABASE_*` values, the rest are function secrets.

export type ServiceEnv = { supabaseUrl: string; serviceRoleKey: string };
export type SupabaseEnv = ServiceEnv & { anonKey: string };
export type JevEnv = { typesafeApiKey: string; typesafeBaseUrl: string };
export type ClaudeEnv = { anthropicApiKey: string; anthropicBaseUrl: string };
export type WeatherEnv = { openMeteoUrl: string; geocodingUrl: string };
export type GeocodingEnv = Pick<WeatherEnv, 'geocodingUrl'>;
export type WebhookEnv = { webhookSecret: string };
/** Everything an outfit function can read. */
export type FnEnv = SupabaseEnv & JevEnv & ClaudeEnv & WeatherEnv;

type Capabilities = {
  supabase: SupabaseEnv;
  service: ServiceEnv;
  jev: JevEnv;
  claude: ClaudeEnv;
  weather: WeatherEnv;
  geocoding: GeocodingEnv;
  webhook: WebhookEnv;
};
export type Capability = keyof Capabilities;

type Intersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
export type EnvOf<C extends Capability> = Intersection<Capabilities[C]>;

/** A variable: required unless it has a `fallback`; a `url` loses its trailing slashes. */
type Variable = { name: string; fallback?: string; url?: true };

const SUPABASE_URL: Variable = { name: 'SUPABASE_URL', url: true };
const SERVICE_ROLE_KEY: Variable = { name: 'SUPABASE_SERVICE_ROLE_KEY' };
const GEOCODING_URL: Variable = { name: 'OPEN_METEO_GEOCODING_URL', fallback: 'https://geocoding-api.open-meteo.com', url: true };

const VARIABLES: { [C in Capability]: Record<keyof Capabilities[C], Variable> } = {
  supabase: { supabaseUrl: SUPABASE_URL, anonKey: { name: 'SUPABASE_ANON_KEY' }, serviceRoleKey: SERVICE_ROLE_KEY },
  service: { supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY },
  jev: {
    typesafeApiKey: { name: 'TYPESAFE_API_KEY' },
    typesafeBaseUrl: { name: 'TYPESAFE_BASE_URL', fallback: 'https://api.typesafe.ai', url: true },
  },
  claude: {
    anthropicApiKey: { name: 'ANTHROPIC_API_KEY' },
    anthropicBaseUrl: { name: 'ANTHROPIC_BASE_URL', fallback: 'https://api.anthropic.com', url: true },
  },
  weather: {
    openMeteoUrl: { name: 'OPEN_METEO_URL', fallback: 'https://api.open-meteo.com', url: true },
    geocodingUrl: GEOCODING_URL,
  },
  geocoding: { geocodingUrl: GEOCODING_URL },
  webhook: { webhookSecret: { name: 'EXTRACT_WEBHOOK_SECRET' } },
};

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

/** The variables of every capability in `needs`; throws `missing env: NAME` for a required one that's unset or empty. */
export function readEnv<const C extends Capability>(get: (name: string) => string | undefined, needs: readonly C[]): EnvOf<C> {
  const env = new Map<string, string>();
  const wanted = new Set<string>(needs);
  for (const [capability, variables] of Object.entries(VARIABLES)) {
    if (!wanted.has(capability)) continue;
    for (const [field, variable] of Object.entries<Variable>(variables)) {
      const value = get(variable.name) ?? '';
      const resolved = value === '' ? variable.fallback : value;
      if (resolved === undefined) throw new Error(`missing env: ${variable.name}`);
      env.set(field, variable.url === true ? trimSlash(resolved) : resolved);
    }
  }
  return Object.fromEntries(env) as EnvOf<C>;
}

/** The Apple key and app ids for Sign in with Apple's server calls. */
export type AppleEnv = {
  /** `APPLE_TEAM_ID`, the client secret's `iss`. */
  teamId: string;
  /** `APPLE_KEY_ID`, the client secret's `kid`. */
  keyId: string;
  /** `APPLE_PRIVATE_KEY`, the `.p8` file's PKCS#8 PEM (literal `\n`s are accepted). */
  privateKey: string;
  /** `APPLE_CLIENT_ID`, the app's bundle id: the client secret's `sub` and the `client_id`. */
  clientId: string;
  /** `APPLE_BASE_URL`; Apple itself unless a mock is set locally. */
  baseUrl: string;
};

export const APPLE_DEFAULT_BASE_URL = 'https://appleid.apple.com';

const APPLE_REQUIRED = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID'] as const;

/**
 * Null (the Apple calls are skipped, never failed) when a required variable is missing, blank or an
 * unresolved `env(...)` literal, which a bare `supabase start` passes through instead of leaving unset.
 */
export function appleEnvFrom(get: (name: string) => string | undefined): AppleEnv | null {
  const values = APPLE_REQUIRED.map((name) => get(name)?.trim() ?? '');
  const [teamId = '', keyId = '', privateKey = '', clientId = ''] = values;
  if (values.some((value) => value === '' || value.startsWith('env('))) return null;
  const baseUrl = get('APPLE_BASE_URL')?.trim() ?? '';
  return { teamId, keyId, privateKey, clientId, baseUrl: trimSlash(baseUrl === '' ? APPLE_DEFAULT_BASE_URL : baseUrl) };
}
