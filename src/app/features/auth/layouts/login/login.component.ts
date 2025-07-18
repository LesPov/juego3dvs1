// CÓDIGO TS COMPLETO Y MEJORADO

import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { auth } from '../../interfaces/auth';
import { authService } from '../../services/auths';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Preferences } from '@capacitor/preferences';
// ===== NUEVO: Importa finalize de RxJS para manejar el estado de carga =====
import { finalize } from 'rxjs/operators';
// ========================================================================

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {

  user: auth = {
    username: '',
    password: '',
    email: '',
    passwordorrandomPassword: '',
  };

  rememberMe: boolean = false;
  // ===== NUEVO: Variable para controlar el estado de carga del botón =====
  isLoading: boolean = false;
  // ======================================================================

  constructor(
    private toastr: ToastrService,
    private authService: authService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.loadCredentials();
  }

  async loadCredentials() {
    try {
      const { value } = await Preferences.get({ key: 'userCredentials' });
      if (value) {
        const credentials = JSON.parse(value);
        this.user.username = credentials.username;
        this.user.passwordorrandomPassword = credentials.password;
        this.rememberMe = true;
      }
    } catch (error) {
      console.error('Error al cargar credenciales:', error);
    }
  }

  loginUser(): void {
    if (!this.areFieldsValid()) {
      this.toastr.error('Todos los campos son obligatorios', 'Error');
      return;
    }

    // ===== MODIFICADO: Activamos el estado de carga =====
    this.isLoading = true;

    this.authService.login(this.user)
      .pipe(
        // ===== NUEVO: finalize se ejecuta siempre, al completar o al dar error =====
        finalize(() => this.isLoading = false)
        // ==========================================================================
      )
      .subscribe({
        next: response => {
          if (response.token) {
            this.handleCredentialsPersistence();
            this.handleSuccessfulLogin(response);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.handleError(err);
        }
      });
  }

  private async handleCredentialsPersistence() {
    if (this.rememberMe) {
      await Preferences.set({
        key: 'userCredentials',
        value: JSON.stringify({
          username: this.user.username,
          password: this.user.passwordorrandomPassword
        })
      });
    } else {
      await Preferences.remove({ key: 'userCredentials' });
    }
  }

  private areFieldsValid(): boolean {
    return !!this.user.username?.trim() && !!this.user.passwordorrandomPassword?.trim();
  }

  private handleSuccessfulLogin(response: any): void {
    this.toastr.success(`Bienvenido, ${this.user.username}!`, 'Login Exitoso');
    localStorage.setItem('token', response.token);
    if (response.userId) {
      localStorage.setItem('userId', response.userId);
    }

    if (response.passwordorrandomPassword === 'randomPassword') {
      this.router.navigate(['/auth/resetPassword'], { queryParams: { username: this.user.username, token: response.token }});
    } else {
      this.redirectBasedOnRole(response.rol);
    }
  }

  private redirectBasedOnRole(role: string): void {
    const roleRoutes: Record<string, string> = {
      'admin': '/admin/dashboard',
      'user': '/user/dashboard',
   
    };
    const route = roleRoutes[role] || '/';
    this.router.navigate([route]);
  }

  private handleError(error: HttpErrorResponse): void {
    const errorMsg = error.error?.msg || 'Credenciales incorrectas o error en el servidor.';
    this.toastr.error(errorMsg, 'Error de inicio de sesión');
  }
}