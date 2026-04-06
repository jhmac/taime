import { z } from "zod";

const serverSchema = z.object({
  port: z.coerce.number().default(5000),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  logLevel: z.string().default(""),
  appUrl: z.string().optional().default(""),
});

const databaseSchema = z.object({
  url: z.string().min(1, "DATABASE_URL is required"),
  poolMin: z.coerce.number().default(2),
  poolMax: z.coerce.number().default(10),
});

const clerkSchema = z.object({
  secretKey: z.string().optional().default(""),
  publishableKey: z.string().optional().default(""),
  webhookSecret: z.string().optional().default(""),
});

const shopifySchema = z.object({
  apiKey: z.string().optional().default(""),
  apiSecret: z.string().optional().default(""),
  storeDomain: z.string().optional().default(""),
});

const anthropicSchema = z.object({
  apiKey: z.string().optional().default(""),
});

const nylasSchema = z.object({
  apiKey: z.string().optional().default(""),
  grantId: z.string().optional().default(""),
});

const vapidSchema = z.object({
  publicKey: z.string().optional().default(""),
  privateKey: z.string().optional().default(""),
});

const encryptionSchema = z.object({
  tokenEncryptionKey: z.string().optional().default(""),
  sessionSecret: z.string().optional().default(""),
});

const youtubeSchema = z.object({
  apiKey: z.string().optional().default(""),
  clientId: z.string().optional().default(""),
  clientSecret: z.string().optional().default(""),
  channelId: z.string().optional().default(""),
});

const awsSchema = z.object({
  accessKeyId: z.string().optional().default(""),
  secretAccessKey: z.string().optional().default(""),
  s3Bucket: z.string().optional().default(""),
  cloudfrontDomain: z.string().optional().default(""),
});

const googleMapsSchema = z.object({
  apiKey: z.string().optional().default(""),
});

const configSchema = z.object({
  server: serverSchema,
  database: databaseSchema,
  clerk: clerkSchema,
  shopify: shopifySchema,
  anthropic: anthropicSchema,
  nylas: nylasSchema,
  vapid: vapidSchema,
  encryption: encryptionSchema,
  youtube: youtubeSchema,
  aws: awsSchema,
  googleMaps: googleMapsSchema,
});

export type AppConfig = z.infer<typeof configSchema>;

const RECOMMENDED_VARS: Array<{ path: string; label: string }> = [
  { path: "clerk.secretKey", label: "CLERK_SECRET_KEY (authentication)" },
  { path: "clerk.publishableKey", label: "CLERK_PUBLISHABLE_KEY (authentication)" },
  { path: "anthropic.apiKey", label: "ANTHROPIC_API_KEY (AI features)" },
];

const PRODUCTION_REQUIRED_VARS: Array<{ path: string; label: string }> = [
  { path: "clerk.secretKey", label: "CLERK_SECRET_KEY" },
  { path: "clerk.publishableKey", label: "CLERK_PUBLISHABLE_KEY" },
  { path: "anthropic.apiKey", label: "ANTHROPIC_API_KEY" },
  { path: "nylas.apiKey", label: "NYLAS_API_KEY" },
  { path: "nylas.grantId", label: "NYLAS_GRANT_ID" },
  { path: "vapid.publicKey", label: "VAPID_PUBLIC_KEY" },
  { path: "vapid.privateKey", label: "VAPID_PRIVATE_KEY" },
  { path: "shopify.apiKey", label: "SHOPIFY_API_KEY" },
  { path: "shopify.apiSecret", label: "SHOPIFY_API_SECRET" },
];

function getNestedValue(obj: Record<string, any>, path: string): unknown {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function loadConfig(): AppConfig {
  const raw = {
    server: {
      port: process.env.PORT,
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL,
      appUrl: process.env.APP_URL,
    },
    database: {
      url: process.env.DATABASE_URL,
      poolMin: process.env.DB_POOL_MIN,
      poolMax: process.env.DB_POOL_MAX,
    },
    clerk: {
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      webhookSecret: process.env.CLERK_WEBHOOK_SECRET,
    },
    shopify: {
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecret: process.env.SHOPIFY_API_SECRET,
      storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    nylas: {
      apiKey: process.env.NYLAS_API_KEY,
      grantId: process.env.NYLAS_GRANT_ID,
    },
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    },
    encryption: {
      tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
      sessionSecret: process.env.SESSION_SECRET,
    },
    youtube: {
      apiKey: process.env.YOUTUBE_API_KEY,
      clientId: process.env.YOUTUBE_CLIENT_ID,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
      channelId: process.env.YOUTUBE_CHANNEL_ID,
    },
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      s3Bucket: process.env.AWS_S3_BUCKET,
      cloudfrontDomain: process.env.AWS_CLOUDFRONT_DOMAIN,
    },
    googleMaps: {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
    },
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const missing = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
    );
    console.error("\n[Config] FATAL: Invalid or missing environment variables:\n" + missing.join("\n") + "\n");
    process.exit(1);
  }

  if (!result.data.server.logLevel) {
    result.data.server.logLevel = result.data.server.nodeEnv === "production" ? "info" : "debug";
  }

  const isProduction = result.data.server.nodeEnv === "production";

  if (isProduction) {
    const missingRequired = PRODUCTION_REQUIRED_VARS.filter(
      (v) => !getNestedValue(result.data, v.path)
    );
    if (missingRequired.length > 0) {
      console.error(
        `\n[Config] FATAL: Missing required environment variables for production:\n` +
        missingRequired.map((v) => `  - ${v.label}`).join("\n") + "\n"
      );
      process.exit(1);
    }
  } else {
    const missingRecommended = RECOMMENDED_VARS.filter(
      (v) => !getNestedValue(result.data, v.path)
    );
    if (missingRecommended.length > 0) {
      console.warn(
        `[Config] Warning: Missing recommended environment variables:\n` +
        missingRecommended.map((v) => `  - ${v.label}`).join("\n")
      );
    }
  }

  return result.data;
}

export const config = loadConfig();
