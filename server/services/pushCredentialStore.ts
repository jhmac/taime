import type { IStorage } from "../storage";

const APNS_KEYS = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY_P8", "APNS_BUNDLE_ID"] as const;
const FCM_KEY = "FCM_SERVICE_ACCOUNT_JSON";

type CredentialCache = {
  apnsKeyId: string | null;
  apnsTeamId: string | null;
  apnsKeyP8: string | null;
  apnsBundleId: string | null;
  fcmServiceAccountJson: string | null;
};

const cache: CredentialCache = {
  apnsKeyId: null,
  apnsTeamId: null,
  apnsKeyP8: null,
  apnsBundleId: null,
  fcmServiceAccountJson: null,
};

let initialized = false;

export async function initPushCredentialStore(storage: IStorage): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    cache.apnsKeyId = await storage.getPushCredential("APNS_KEY_ID");
    cache.apnsTeamId = await storage.getPushCredential("APNS_TEAM_ID");
    cache.apnsKeyP8 = await storage.getPushCredential("APNS_KEY_P8");
    cache.apnsBundleId = await storage.getPushCredential("APNS_BUNDLE_ID");
    cache.fcmServiceAccountJson = await storage.getPushCredential(FCM_KEY);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes('push_credentials') || msg.includes('does not exist')) {
      console.warn('[PushCredentialStore] push_credentials table not yet created — falling back to env vars');
      initialized = false;
    } else {
      throw err;
    }
  }
}

function resolveApns() {
  return {
    keyId: cache.apnsKeyId || process.env.APNS_KEY_ID || "",
    teamId: cache.apnsTeamId || process.env.APNS_TEAM_ID || "",
    keyP8: cache.apnsKeyP8 || process.env.APNS_KEY_P8 || "",
    bundleId: cache.apnsBundleId || process.env.APNS_BUNDLE_ID || "",
  };
}

function resolveFcmJson(): string {
  return cache.fcmServiceAccountJson || process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FCM_SERVER_KEY || "";
}

export function isApnsReady(): boolean {
  const c = resolveApns();
  return !!(c.keyId && c.teamId && c.keyP8);
}

export function isFcmReady(): boolean {
  const raw = resolveFcmJson();
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.project_id && parsed.private_key && parsed.client_email) return true;
  } catch {
    // Not JSON — treat as legacy server key if non-empty
  }
  try {
    JSON.parse(raw);
    return false;
  } catch {
    return raw.length > 0;
  }
}

export function getApnsCredentials() {
  return resolveApns();
}

export function getFcmCredential(): string {
  return resolveFcmJson();
}

export async function saveApnsCredentials(
  storage: IStorage,
  keyId: string,
  teamId: string,
  keyP8: string,
  bundleId: string,
): Promise<void> {
  await storage.setPushCredential("APNS_KEY_ID", keyId);
  await storage.setPushCredential("APNS_TEAM_ID", teamId);
  await storage.setPushCredential("APNS_KEY_P8", keyP8);
  await storage.setPushCredential("APNS_BUNDLE_ID", bundleId);
  cache.apnsKeyId = keyId;
  cache.apnsTeamId = teamId;
  cache.apnsKeyP8 = keyP8;
  cache.apnsBundleId = bundleId;
}

export async function saveFcmCredentials(
  storage: IStorage,
  serviceAccountJson: string,
): Promise<void> {
  await storage.setPushCredential(FCM_KEY, serviceAccountJson);
  cache.fcmServiceAccountJson = serviceAccountJson;
}
