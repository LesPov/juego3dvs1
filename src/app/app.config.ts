// src/app/app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withInMemoryScrolling, withPreloading, NoPreloading } from '@angular/router';
import { provideHttpClient, withInterceptors, withInterceptorsFromDi } from '@angular/common/http'; // ¡Importante!
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideToastr } from 'ngx-toastr';
import { registerLocaleData } from '@angular/common';
import localeEsCo from '@angular/common/locales/es-CO';
import { routes } from './app.routes';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';

registerLocaleData(localeEsCo, 'es-CO');

export const appConfig: ApplicationConfig = {
  providers: [
    // 1. Configuración del Router
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
      withPreloading(NoPreloading)
    ),

    // 2. Configuración de HttpClient y sus Interceptors (¡MÉTODO CORREGIDO!)
    provideHttpClient(
        // Esta función le dice a Angular que esté listo para usar interceptors.
        withInterceptorsFromDi()
    ),

    // 3. Registrar nuestro Interceptor de forma explícita
    // Esto asegura que la clase AuthInterceptor se use para todas las peticiones.
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true, // Esencial porque puede haber múltiples interceptors
    },

    // 4. Otros providers
    provideAnimations(),
    provideToastr({
      timeOut: 3000,
      positionClass: 'toast-bottom-right',
      preventDuplicates: true,
    }),
  ],
};