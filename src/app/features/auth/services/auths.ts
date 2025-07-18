/**
 * Servicio de autenticación
 * 
 * Este servicio se encarga de gestionar la comunicación con el backend para:
 * - Registrar usuarios.
 * - Verificar correos electrónicos y números de teléfono.
 * - Iniciar sesión y almacenar el token de autenticación.
 * - Reenviar códigos de verificación cuando sea necesario.
 * 
 * Se utiliza HttpClient para las peticiones HTTP y se configura la URL base
 * a partir del entorno (environment).
 */
import { HttpHeaders, HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { auth } from "../interfaces/auth";
import { environment } from "../../../../environments/environment";
import { Observable, tap } from "rxjs";
import { LoginResponse } from "../interfaces/loginResponse";

@Injectable({
    providedIn: 'root',
})
export class authService {
    // URL base para las rutas de autenticación
    private baseUrl: string = `${environment.endpoint}auth/user/`;
    // Encabezados para las peticiones HTTP
    private headers = new HttpHeaders().set('Content-Type', 'application/json');

    constructor(private http: HttpClient) { }
    public isAdmin(): boolean {
        const token = localStorage.getItem('token');
        if (!token) return false;
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          // Se comprueba si la propiedad 'rol' (o 'role') es 'admin'
          const userRole = payload.rol || payload.role;
          return userRole && userRole.toLowerCase() === 'admin';
        } catch (error) {
          console.error('Error leyendo el token:', error);
          return false;
        }
      }
      
    /**
     * Registra un nuevo usuario.
     * @param user Objeto con los datos del usuario.
     * @returns Observable de tipo void.
     */
    register(user: auth): Observable<void> {
        return this.http.post<void>(`${this.baseUrl}register`, user, { headers: this.headers });
    }

    /**
     * Verifica el correo electrónico del usuario.
     * @param username Nombre de usuario (correo electrónico).
     * @param verificationCode Código de verificación.
     * @returns Observable de tipo any.
     */
    verifyEmail(username: string, verificationCode: string): Observable<any> {
        return this.http.put<any>(`${this.baseUrl}verify/email`, { username, verificationCode }, { headers: this.headers });
    }

    /**
     * Reenvía el correo electrónico de verificación.
     * @param username Nombre de usuario.
     * @returns Observable de tipo void.
     */
    resendVerificationEmail(username: string): Observable<void> {
        return this.http.post<void>(`${this.baseUrl}verify/email/resend`, { username }, { headers: this.headers });
    }

    /**
     * Registra el número de teléfono del usuario.
     * @param username Nombre de usuario.
     * @param phoneNumber Número de teléfono.
     * @returns Observable de tipo void.
     */
    registerPhoneNumber(username: string, phoneNumber: string): Observable<void> {
        return this.http.post<void>(`${this.baseUrl}phone/send`, { username, phoneNumber }, { headers: this.headers });
    }

    /**
     * Obtiene la lista de países.
     * @returns Observable con un arreglo de países.
     */
    getCountries(): Observable<any[]> {
        return this.http.get<any[]>(`${this.baseUrl}countries`, { headers: this.headers });
    }

    /**
     * Reenvía el código de verificación del teléfono.
     * @param username Nombre de usuario.
     * @param phoneNumber Número de teléfono.
     * @returns Observable de tipo void.
     */
    resendVerificationPhone(username: string, phoneNumber: string): Observable<void> {
        return this.http.post<void>(`${this.baseUrl}phone/verify/resend`, { username, phoneNumber }, { headers: this.headers });
    }

    /**
     * Verifica el número de teléfono del usuario.
     * @param username Nombre de usuario.
     * @param phoneNumber Número de teléfono.
     * @param verificationCode Código de verificación.
     * @returns Observable de tipo any.
     */
    verifyPhoneNumber(username: string, phoneNumber: string, verificationCode: string): Observable<any> {
        return this.http.put<any>(`${this.baseUrl}phone/verify`, { username, phoneNumber, verificationCode }, { headers: this.headers });
    }

    /**
     * Realiza el login del usuario.
     * Si es exitoso, almacena el token y el userId en el localStorage.
     * @param user Objeto con las credenciales del usuario.
     * @returns Observable con la respuesta de tipo LoginResponse.
     */
    login(user: auth): Observable<LoginResponse> {
        return this.http.post<LoginResponse>(`${this.baseUrl}login`, user, { headers: this.headers })
            .pipe(
                tap(response => {
                    if (response.token) {
                        localStorage.setItem('token', response.token);
                        if (response.userId) {
                            localStorage.setItem('userId', response.userId);
                        }
                    }
                })
            );
    }
    // authService.ts
    requestPasswordReset(usernameOrEmail: string): Observable<void> {
        return this.http.post<void>(
            `${this.baseUrl}login/forgotPassword`,
            { usernameOrEmail },
            { headers: this.headers }
        );
    }

    resetPassword(usernameOrEmail: string, randomPassword: string, newPassword: string, token: string): Observable<void> {
        // Se construye el header con el token recibido
        const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
        return this.http.post<void>(
            `${this.baseUrl}login/resetPassword`,
            { usernameOrEmail, randomPassword, newPassword },
            { headers }
        );
    }


}
