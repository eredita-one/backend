import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator.js';
import type { RequestMeta } from '../application/session.service.js';
import {
  StaffAuthService,
  staffProfileFromPrincipal,
} from '../application/staff-auth.service.js';
import { STAFF_APPS } from '../domain/apps.js';
import type { StaffPrincipal } from '../domain/principal.js';
import { CurrentStaff, ReqMeta, StaffApps } from './access-policy.js';
import { AuthRateLimit } from './auth-rate-limit.js';
import {
  RefreshTokenDto,
  StaffLoginDto,
  StaffProfileDto,
  StaffSessionDto,
  TokenPairDto,
} from './dto/auth.dto.js';

@ApiTags('Auth · equipe interna')
@Controller('auth/staff')
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StaffSessionDto })
  login(@Body() dto: StaffLoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(
      {
        email: dto.email,
        password: dto.password,
        app: dto.app,
        remember: dto.remember ?? false,
      },
      meta,
    );
  }

  @Public()
  @AuthRateLimit()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenPairDto })
  refresh(@Body() dto: RefreshTokenDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Public()
  @AuthRateLimit()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @StaffApps(...STAFF_APPS)
  @Get('me')
  @ApiOkResponse({ type: StaffProfileDto })
  me(@CurrentStaff() principal: StaffPrincipal): StaffProfileDto {
    return staffProfileFromPrincipal(principal);
  }
}
