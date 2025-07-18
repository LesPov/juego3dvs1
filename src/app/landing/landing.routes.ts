// INICIO: inicioRouter.ts
import { Routes } from '@angular/router';

export const inicioRouter: Routes = [
    {
        path: 'inicio',
        loadComponent: () =>
            import('../landing/layouts/body-inicio/body-inicio.component').then(m => m.BodyInicioComponent),
        children: [
            {
                path: '',
                loadComponent: () =>
                    import('../landing/components/inicio/inicio.component').then(m => m.InicioComponent)
            },
          
        ]
    }
];
// FIN: inicioRouter.ts