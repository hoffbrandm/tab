export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}
