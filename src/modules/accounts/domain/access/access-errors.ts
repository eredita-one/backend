import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../../common/exceptions/app.exception.js';
import { ErrorCode } from '../../../../common/exceptions/error-codes.js';
import type { StaffApp } from '../apps.js';

/** Erros da gestão de acessos. O `code` é o que o front traduz. */
export const AccessErrors = {
  profileNotFound: (ids: readonly string[]) =>
    new AppException(
      ErrorCode.ACCESS_PROFILE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'Access profile not found',
      { ids },
    ),

  userNotFound: () =>
    new AppException(
      ErrorCode.STAFF_USER_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'Staff user not found',
    ),

  unknownPermissions: (app: StaffApp, permissions: readonly string[]) =>
    new AppException(
      ErrorCode.ACCESS_UNKNOWN_PERMISSION,
      HttpStatus.UNPROCESSABLE_ENTITY,
      `Permissions do not belong to the ${app} catalog`,
      { app, permissions },
    ),

  /** Quem age não tem autoridade: falta permissão de gestão ou alguma permissão do perfil. */
  escalationDenied: (missing: readonly string[]) =>
    new AppException(
      ErrorCode.ACCESS_ESCALATION_DENIED,
      HttpStatus.FORBIDDEN,
      'You cannot grant, revoke or edit permissions you do not hold',
      { missing },
    ),

  selfChangeDenied: () =>
    new AppException(
      ErrorCode.ACCESS_SELF_CHANGE_DENIED,
      HttpStatus.FORBIDDEN,
      'You cannot change your own access',
    ),

  lastGeneralAdmin: () =>
    new AppException(
      ErrorCode.ACCESS_LAST_GENERAL_ADMIN,
      HttpStatus.CONFLICT,
      'This would leave the system without an active general administrator',
    ),

  systemProfileReadonly: () =>
    new AppException(
      ErrorCode.ACCESS_SYSTEM_PROFILE_READONLY,
      HttpStatus.CONFLICT,
      'System profiles cannot be edited or deleted',
    ),

  profileInUse: (holders: number) =>
    new AppException(
      ErrorCode.ACCESS_PROFILE_IN_USE,
      HttpStatus.CONFLICT,
      'Profile is assigned to users',
      { holders },
    ),

  profileNameTaken: () =>
    new AppException(
      ErrorCode.ACCESS_PROFILE_NAME_TAKEN,
      HttpStatus.CONFLICT,
      'A profile with this name already exists in this app',
    ),

  emailTaken: () =>
    new AppException(
      ErrorCode.STAFF_USER_EMAIL_TAKEN,
      HttpStatus.CONFLICT,
      'A staff user with this email already exists',
    ),
};
