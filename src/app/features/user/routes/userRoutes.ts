import { Routes } from '@angular/router';
 import { RoleGuard } from '../../../core/guard/autorization.guard';

export const userRouter: Routes = [
  {
    path: 'user',
    loadComponent: () => import('../../user/layout/body-user/body-user.component').then(m => m.BodyUserComponent),
    canActivate: [RoleGuard],
    data: { allowedRoles: ['user'] },
    children: [
 
      {
        path: 'profile',
        loadComponent: () => import('../../profile/component/view-profile/view-profile.component')
          .then(m => m.ViewProfileComponent)
      },
      {
        path: 'dashboard',
        loadComponent: () => import('../../user/components/dashboard-user/dashboard-user.component')
          .then(m => m.DashboardUserComponent)
      },
      

      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      }
    ]
  }
];
