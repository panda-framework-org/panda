import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createLogger } from "@panda/shared";
import { defaultPandaConfig } from "@panda/core";
import { persistenceModeFromEnvironment } from "./execution-runtime.js";
import { createDaemon } from "./server.js";
import {
  allowedOriginsFromEnvironment,
  assertSafeNetworkExposure,
  bearerAuthenticationFromEnvironment,
} from "./api-security.js";

export * from "./execution-runtime.js";
export * from "./server.js";
export * from "./api-security.js";
export * from "./flow-record-store.js";

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const logger = createLogger("daemon");
  const config = defaultPandaConfig();
  try {
    const authentication = bearerAuthenticationFromEnvironment(
      process.env.PANDA_API_TOKEN,
      process.env.PANDA_API_PRINCIPAL_ID,
    );
    assertSafeNetworkExposure(config.daemonHost, authentication);
    const { app } = await createDaemon({
      dataDirectory: process.env.PANDA_DATA_DIRECTORY,
      persistence: persistenceModeFromEnvironment(process.env.PANDA_PERSISTENCE),
      authentication,
      allowedOrigins: allowedOriginsFromEnvironment(
        process.env.PANDA_ALLOWED_ORIGINS,
      ),
    });
    await app.listen({ host: config.daemonHost, port: config.daemonPort });
    logger.info(`listening on http://${config.daemonHost}:${config.daemonPort}`);
  } catch (error) {
    logger.error("failed to start daemon", error);
    process.exitCode = 1;
  }
}
