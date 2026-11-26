import {
  HttpStatus,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { AppException } from '../exceptions/app.exception.js';
import { ErrorCode } from '../exceptions/error-codes.js';

type FieldError = { field: string; constraints: string[] };

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field, constraints: Object.keys(error.constraints) }]
      : [];
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/**
 * Validação global dos DTOs. Campos fora do DTO são rejeitados (`forbidNonWhitelisted`),
 * e os erros saem como `VALIDATION_FAILED` com a lista de campos e regras violadas.
 */
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Validation failed',
        flatten(errors),
      ),
  });
}
