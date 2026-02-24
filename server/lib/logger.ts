import pino from "pino";
import { config } from "./config";

const isProduction = config.server.nodeEnv === "production";
const logLevel = config.server.logLevel;

const logger = pino({
  level: logLevel,
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
});

export default logger;
