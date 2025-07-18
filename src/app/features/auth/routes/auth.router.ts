import { Routes } from '@angular/router';

export const authenticationRoutes: Routes = [
    { path: 'auth/login', loadComponent: () => import('../../auth/layouts/login/login.component').then(m => m.LoginComponent) },
    { path: 'auth/passwordrecovery', loadComponent: () => import('../../auth/layouts/login/password-recovery/password-recovery.component').then(m => m.PasswordRecoveryComponent) },
    { path: 'auth/resetPassword', loadComponent: () => import('../../auth/layouts/login/reset-password-recovery/reset-password-recovery.component').then(m => m.ResetPasswordRecoveryComponent) },
    { path: 'auth/register', loadComponent: () => import('../../auth/layouts/register/register.component').then(m => m.RegisterComponent) },
    { path: 'auth/email', loadComponent: () => import('../../auth/layouts/email/email.component').then(m => m.EmailComponent) },
    { path: 'auth/number', loadComponent: () => import('../../auth/layouts/number/number.component').then(m => m.NumberComponent) },
    { path: 'auth/verifynumber', loadComponent: () => import('../../auth/layouts/verify-number/verify-number.component').then(m => m.VerifyNumberComponent) },
    // Ruta por defecto para redirigir a login
];
