import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.js';

export type ErrorBody = {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
};

/** Erro de aplicação com código estável. Prefira esta classe a `HttpException`. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    message: string,
    readonly details?: unknown,
  ) {
    super(
      { statusCode: status, code, message, details } satisfies ErrorBody,
      status,
    );
  }
}

/** Regra de negócio violada (422). */
export class BusinessRuleException extends AppException {
  constructor(message: string, details?: unknown) {
    super(
      ErrorCode.BUSINESS_RULE,
      HttpStatus.UNPROCESSABLE_ENTITY,
      message,
      details,
    );
  }
}

/** Recurso inexistente (404). */
export class ResourceNotFoundException extends AppException {
  constructor(resource: string) {
    super(
      ErrorCode.RESOURCE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      `${resource} not found`,
    );
  }
}
