// src/app/core/interceptors/auth.interceptor.ts
import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpInterceptor,
  HttpHandler,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor() {}

  /**
   * Intercepta cada petición HTTP saliente.
   */
  intercept(
    req: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    // 1. Obtener el token del localStorage
    const token = localStorage.getItem('token');

    // 2. Si no hay token, deja que la petición continúe sin modificarla.
    // (Esto es importante para las rutas públicas como login o register).
    if (!token) {
      return next.handle(req);
    }

    // 3. Si hay un token, clona la petición y añade el header 'Authorization'.
    // Es importante clonar la petición porque las peticiones son inmutables.
    const authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log('Interceptor: Token añadido a la petición', authReq.headers.get('Authorization'));

    // 4. Envía la petición clonada y modificada al siguiente manejador.
    return next.handle(authReq);
  }
}