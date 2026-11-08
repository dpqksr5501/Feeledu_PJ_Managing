import express from "express";
import helmet from "helmet";
export function createHttpApp({
  production = false,
  publicOrigin,
  trustProxy,
}: { production?: boolean; publicOrigin?: string; trustProxy?: number } = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              upgradeInsecureRequests: null,
            },
          }
        : false,
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("X-Requested-With") !== "Feeledu")
        return res.status(403).json({ error: "허용되지 않은 요청입니다." });
      const origin = req.get("Origin");
      if (
        origin &&
        origin !== (publicOrigin || `${req.protocol}://${req.get("host")}`)
      )
        return res.status(403).json({ error: "접속 주소를 확인해 주세요." });
    }
    next();
  });

  return app;
}
