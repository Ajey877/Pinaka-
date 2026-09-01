export class ReviewError extends Error {
  constructor(message, code = "REVIEW_ERROR", details = undefined) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
    this.details = details;
  }
}
