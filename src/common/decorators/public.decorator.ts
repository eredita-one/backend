import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Libera a rota sem token. Use só em login, refresh, logout e health. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
