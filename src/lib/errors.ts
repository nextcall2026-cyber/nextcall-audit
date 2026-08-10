export class ApplicationError extends Error {
  // Removed 'readonly' so subclasses can override the code
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ApplicationError";
  }
}

export class ProviderError extends ApplicationError {
  constructor(message: string, public readonly provider: string) {
    super(message, "PROVIDER_ERROR");
    this.name = "ProviderError";
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, provider);
    this.code = "RATE_LIMIT_ERROR";
    this.name = "RateLimitError";
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}