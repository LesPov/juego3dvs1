import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { jwtDecode } from 'jwt-decode';

export interface TokenPayload {
  userId: number;
  rol: string;
  // Puedes incluir más propiedades según lo que envíe tu token
}

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {

  constructor(private router: Router) { }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean {
    // Obtener el token del localStorage
    const token = localStorage.getItem('token');
    if (!token) {
      // Si no hay token, redirige al login
    this.router.navigate(['/auth/login']); // <-- CORREGIDO
      return false;
    }

    try {
      // Decodificar el token para extraer el payload
      const payload: TokenPayload = jwtDecode(token);
      
      // Obtener los roles permitidos definidos en la ruta
      const allowedRoles = route.data['allowedRoles'];
      // Convertir a arreglo si es que se pasó un string
      const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

      // Verificar si el rol del token está permitido
      if (rolesArray.includes(payload.rol)) {
        return true;
      } else {
        // Redirigir en caso de rol no autorizado (puedes crear una ruta 'unauthorized' o similar)
        this.router.navigate(['/unauthorized']);
        return false;
      }
    } catch (error) {
      // Si ocurre algún error al decodificar el token, redirige al login
    this.router.navigate(['/auth/login']); // <-- CORREGIDO
      return false;
    }
  }
}
