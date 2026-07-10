import * as oidc from 'openid-client';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

interface OidcProvider {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
}

function getProviders(): OidcProvider[] {
  const providers: OidcProvider[] = [];
  if (config.oidcGoogleClientId && config.oidcGoogleClientSecret) {
    providers.push({ name: 'google', issuer: 'https://accounts.google.com', clientId: config.oidcGoogleClientId, clientSecret: config.oidcGoogleClientSecret });
  }
  if (config.oidcMicrosoftClientId && config.oidcMicrosoftClientSecret) {
    providers.push({ name: 'microsoft', issuer: `https://login.microsoftonline.com/${config.oidcMicrosoftTenant}/v2.0`, clientId: config.oidcMicrosoftClientId, clientSecret: config.oidcMicrosoftClientSecret });
  }
  return providers;
}

const configCache = new Map<string, any>();

async function getServerConfig(provider: OidcProvider) {
  if (configCache.has(provider.issuer)) return configCache.get(provider.issuer);
  const cfg = await oidc.discovery(new URL(provider.issuer), provider.clientId, provider.clientSecret);
  configCache.set(provider.issuer, cfg);
  return cfg;
}

export function isOidcEnabled(): boolean { return getProviders().length > 0; }
export function getEnabledProviderNames(): string[] { return getProviders().map(p => p.name); }

// OAuth state is stateless: a short-lived signed JWT carrying the PKCE verifier,
// provider, and the origin to return to. Survives restarts and multiple instances.
interface StatePayload { providerName: string; codeVerifier: string; returnTo: string; }

function encodeState(payload: StatePayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '10m' });
}

function decodeState(state: string): StatePayload {
  return jwt.verify(state, config.jwtSecret) as unknown as StatePayload;
}

export async function getAuthorizationUrl(providerName: string, redirectUri: string, returnTo: string): Promise<string> {
  const provider = getProviders().find(p => p.name === providerName);
  if (!provider) throw new Error('Unknown OIDC provider: ' + providerName);
  const serverConfig = await getServerConfig(provider);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = encodeState({ providerName, codeVerifier, returnTo });
  const url = oidc.buildAuthorizationUrl(serverConfig, { redirect_uri: redirectUri, scope: 'openid email profile', code_challenge: codeChallenge, code_challenge_method: "S256", state, prompt: "select_account" });
  return url.href;
}

export interface OidcUser { email: string; name: string; sub: string; provider: string; picture?: string; returnTo: string; }

export async function handleCallback(fullCallbackUrl: string): Promise<OidcUser> {
  const url = new URL(fullCallbackUrl);
  // Behind a TLS-terminating proxy (Cloud Run), the incoming request is http://
  // and may carry an internal host. Normalize the origin to PUBLIC_URL so the
  // redirect_uri sent during the token exchange matches the authorization request.
  if (config.publicUrl) {
    const publicOrigin = new URL(config.publicUrl);
    url.protocol = publicOrigin.protocol;
    url.host = publicOrigin.host;
  }
  const state = url.searchParams.get('state');
  if (!state) throw new Error('Missing state parameter');
  let pending: StatePayload;
  try {
    pending = decodeState(state);
  } catch {
    throw new Error('Invalid or expired state parameter');
  }
  const provider = getProviders().find(p => p.name === pending.providerName);
  if (!provider) throw new Error('Unknown provider: ' + pending.providerName);
  const serverConfig = await getServerConfig(provider);
  const tokens = await oidc.authorizationCodeGrant(serverConfig, url, { pkceCodeVerifier: pending.codeVerifier, expectedState: state });
  const claims = tokens.claims();
  if (!claims) throw new Error('No claims in token');
  const email = (claims.email as string) || '';
  if (!email) throw new Error('OIDC provider did not return an email address');
  return { email, name: (claims.name as string) || email, sub: claims.sub || '', provider: pending.providerName, picture: claims.picture as string | undefined, returnTo: pending.returnTo };
}
