import { Routes } from '@angular/router';
import { inicioRouter } from './landing/landing.routes';
import { authenticationRoutes } from './features/auth/routes/auth.router';
import { adminRouter } from './features/admin/routes/admin.routes';
import { userRouter } from './features/user/routes/userRoutes';
 
export const routes: Routes = [
    ...inicioRouter,
    ...authenticationRoutes,
    ...adminRouter,
    ...userRouter,
     
    { path: 'loading', loadComponent: () => import('./shared/components/loading/loading.component').then(m => m.LoadingComponent) },
    { path: '', redirectTo: '/loading', pathMatch: 'full' },
    { path: '**', redirectTo: '/loading' },
];
