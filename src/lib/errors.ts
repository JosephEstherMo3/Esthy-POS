/** An error that is safe to show to the end user, with an HTTP status and an optional machine-readable code. */
export class HttpError extends Error {
  status: number;
  fieldErrors?: Record<string, string>;
  code?: string;
  constructor(status: number, message: string, fieldErrors?: Record<string, string>, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}
