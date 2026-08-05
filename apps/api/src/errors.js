/**
 * Alkalmazásszintű hiba, amit a service réteg dob, és amit az error handler
 * plugin egységes { error: { code, message, details } } válasszá alakít.
 */
export class AppError extends Error {
  /**
   * @param {string} code Stabil, gépileg olvasható hibakód, pl. "PERSON_IN_USE".
   * @param {string} message Emberi olvasásra szánt üzenet.
   * @param {number} statusCode HTTP státuszkód.
   * @param {unknown} [details] Extra kontextus, pl. érintett rekord id-k.
   */
  constructor(code, message, statusCode, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message, details) {
    super('NOT_FOUND', message, 404, details);
  }
}

export class ConflictError extends AppError {
  constructor(message, details) {
    super('CONFLICT', message, 409, details);
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Bejelentkezés szükséges.') {
    super('UNAUTHORIZED', message, 401);
  }
}
