import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve pre-compressed .gz sidecar files for static assets when the client
  // supports gzip. This avoids on-the-fly compression CPU cost for JS/CSS/etc.
  // The compression() middleware in index.ts remains as a fallback for dynamic
  // API responses and any assets that don't have a .gz sidecar.
  app.use((req, res, next) => {
    const acceptEncoding = req.headers["accept-encoding"] ?? "";
    if (!acceptEncoding.includes("gzip")) {
      return next();
    }

    // Only attempt pre-compressed serving for GET/HEAD requests to static files
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    // Strip query string and resolve file path within dist
    const urlPath = req.path;

    // Skip API, service worker and upload routes — these are dynamic
    if (
      urlPath.startsWith("/api") ||
      urlPath.startsWith("/uploads") ||
      urlPath === "/sw.js"
    ) {
      return next();
    }

    const gzPath = path.join(distPath, urlPath + ".gz");

    fs.access(gzPath, fs.constants.F_OK, (err) => {
      if (err) {
        // No .gz sidecar — fall through to regular static handler
        return next();
      }

      // Determine the original content type from the uncompressed filename
      const ext = path.extname(urlPath).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".wasm": "application/wasm",
        ".txt": "text/plain; charset=utf-8",
        ".xml": "application/xml",
      };
      const contentType =
        contentTypeMap[ext] ?? "application/octet-stream";

      const cacheHeaders: Record<string, string> = {
        "Content-Encoding": "gzip",
        "Content-Type": contentType,
        "Vary": "Accept-Encoding",
      };

      // Hashed assets (e.g. /assets/index-Bx3kj92.js) are safe to cache
      // indefinitely because the filename changes whenever the content changes.
      if (urlPath.startsWith("/assets/")) {
        cacheHeaders["Cache-Control"] =
          "public, max-age=31536000, immutable";
      }

      res.set(cacheHeaders);

      res.sendFile(gzPath, (sendErr) => {
        if (sendErr) {
          // If sending the .gz file fails for any reason, fall through
          res.removeHeader("Content-Encoding");
          next();
        }
      });
    });
  });

  app.use(
    express.static(distPath, {
      setHeaders(res, filePath) {
        // Apply immutable cache headers to content-hashed assets produced by
        // Vite (e.g. assets/index-Bx3kj92.js). The hash in the filename
        // changes whenever the content changes, so browsers can cache these
        // files indefinitely without ever needing to revalidate.
        const relativePath = path.relative(distPath, filePath);
        if (relativePath.startsWith("assets" + path.sep)) {
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        }
      },
    }),
  );

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
