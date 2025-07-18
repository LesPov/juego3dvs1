import { Routes } from '@angular/router';
import { RoleGuard } from '../../../core/guard/autorization.guard';

export const adminRouter: Routes = [

    {
        path: 'admin',
        loadComponent: () => import('../layouts/body-admin/body-admin.component').then(m => m.BodyAdminComponent),
        canActivate: [RoleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
            {
                path: 'profile',
                loadComponent: () => import('../../profile/component/view-profile/view-profile.component')
                    .then(m => m.ViewProfileComponent)
            },
            {
                path: 'dashboard',
                loadComponent: () => import('../components/dashboard-admin/dashboard-admin.component').then(m => m.DashboardAdminComponent)
            },
            {
                path: 'episodios',
                loadComponent: () => import('../components/episodios/episodios.component').then(m => m.EpisodiosComponent)
            },
            {
                path: 'editor/:id',
                loadComponent: () => import('../components/world-view/world-view.component').then(m => m.WorldViewComponent)
            },
            {
                path: 'play/:id',
                loadComponent: () => import('../components/world-view/world-view.component').then(m => m.WorldViewComponent)
            },
            {
                path: '',
                redirectTo: 'dashboard',
                pathMatch: 'full'
            }
        ]
    }
];