export class VerificationError extends Error {
  constructor(message, code = "VERIFICATION_ERROR", details = undefined) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
    this.details = details;
  }
}
