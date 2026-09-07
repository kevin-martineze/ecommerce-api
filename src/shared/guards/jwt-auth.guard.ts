import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Exige un access token válido. No mira tiendas ni roles: solo identidad. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
