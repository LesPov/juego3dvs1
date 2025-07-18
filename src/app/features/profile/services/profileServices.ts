import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Profile } from '../interfaces/profileInterfaces';
import { environment } from '../../../../environments/environment';
 
@Injectable({
  providedIn: 'root',
})
export class ProfileService {
  // Base URL para las rutas de perfil (ajusta según tu API)
  private baseUrl: string = `${environment.endpoint}api/user/profile/`;

  constructor(private http: HttpClient) {}
 // Nuevo método para obtener el perfil por ID

  // Consulta el perfil del usuario autenticado
  getProfile(): Observable<Profile> {
    const token = localStorage.getItem('token') || '';
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    return this.http.get<Profile>(`${this.baseUrl}me`, { headers });
  }

  // Nuevo método: consulta el perfil de un usuario específico por su ID
  getProfileByUserId(userId: number): Observable<Profile> {
    const token = localStorage.getItem('token') || '';
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    // Ejemplo: la URL puede ser algo como `${baseUrl}${userId}`
    return this.http.get<Profile>(`${this.baseUrl}${userId}`, { headers });
  }

  // Actualiza el perfil completo (PUT /client/update-profile)
  updateProfile(profileData: FormData): Observable<any> {
    const token = localStorage.getItem('token') || '';
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    return this.http.put<any>(`${this.baseUrl}user/update-profile`, profileData, { headers });
  }

  // Actualiza el perfil mínimo (PUT /client/update-minimal-profile)
  updateMinimalProfile(data: {  
    identificationType: string;
    identificationNumber: string;
    direccion: string;
    campiamigo: boolean;
  }): Observable<any> {
    const token = localStorage.getItem('token') || '';
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });
    return this.http.put<any>(`${this.baseUrl}user/update-minimal-profile`, data, { headers });
  }
}
