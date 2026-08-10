type LogLevel = "info" | "warn" | "error" | "debug";

const log = (level: LogLevel, message: string, context?: unknown) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  if (level === "error") {
    console.error(logMessage, context ?? "");
  } else if (level === "warn") {
    console.warn(logMessage, context ?? "");
  } else if (level === "debug" && process.env.NODE_ENV === "development") {
    console.debug(logMessage, context ?? "");
  } else {
    console.log(logMessage, context ?? "");
  }
};

export const logger = {
  info: (message: string, context?: unknown) => log("info", message, context),
  warn: (message: string, context?: unknown) => log("warn", message, context),
  error: (message: string, context?: unknown) => log("error", message, context),
  debug: (message: string, context?: unknown) => log("debug", message, context),
};