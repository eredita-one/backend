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
import {
  ClientAuthService,
  clientProfileOf,
} from '../application/client-auth.service.js';
import type { RequestMeta } from '../application/session.service.js';
import type { ClientPrincipal } from '../domain/principal.js';
import { ClientArea, CurrentClient, ReqMeta } from './access-policy.js';
import { AuthRateLimit } from './auth-rate-limit.js';
import {
  ClientProfileDto,
  ClientSessionDto,
  LoginDto,
  RefreshTokenDto,
  TokenPairDto,
} from './dto/auth.dto.js';

@ApiTags('Auth · portal do cliente')
@Controller('auth/client')
export class ClientAuthController {
  constructor(private readonly auth: ClientAuthService) {}

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ClientSessionDto })
  login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(
      {
        email: dto.email,
        password: dto.password,
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

  @ClientArea()
  @Get('me')
  @ApiOkResponse({ type: ClientProfileDto })
  me(@CurrentClient() principal: ClientPrincipal): ClientProfileDto {
    return clientProfileOf(principal);
  }
}
