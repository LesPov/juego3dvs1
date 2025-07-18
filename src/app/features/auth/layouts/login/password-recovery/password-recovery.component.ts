// CÓDIGO TS COMPLETO Y MEJORADO

import { Component } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common'; // Importa CommonModule para *ngIf
import { FormsModule, NgForm } from '@angular/forms';
import { authService } from '../../../services/auths';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-password-recovery',
  standalone: true, // Hacemos el componente standalone para coherencia
  imports: [CommonModule, FormsModule], // Añadimos CommonModule
  templateUrl: './password-recovery.component.html',
  styleUrls: ['./password-recovery.component.css']
})
export class PasswordRecoveryComponent {
  usernameOrEmail: string = '';
  isLoading: boolean = false; // Estado para controlar el spinner del botón

  constructor(
    private authService: authService,
    private toastr: ToastrService,
    private router: Router
  ) {}

  requestPasswordReset(): void {
    if (!this.usernameOrEmail?.trim()) {
      this.toastr.error('Por favor, ingresa tu correo o nombre de usuario.', 'Campo Vacío');
      return;
    }

    this.isLoading = true; // Inicia la carga

    this.authService.requestPasswordReset(this.usernameOrEmail)
      .pipe(
        // finalize() se ejecuta siempre, tanto en éxito como en error.
        // Perfecto para detener el estado de carga.
        finalize(() => this.isLoading = false)
      )
      .subscribe({
        next: (response: any) => {
          this.toastr.success(response.msg || 'Se han enviado las instrucciones a tu correo.', 'Revisa tu Bandeja');
          // Opcional: Redirigir al usuario a una página de "correo enviado" o al login.
          // this.router.navigate(['/auth/login']);
        },
        error: (err: HttpErrorResponse) => {
          const errorMsg = err.error?.msg || 'No se pudo procesar la solicitud. Inténtalo de nuevo.';
          this.toastr.error(errorMsg, 'Error');
        }
      });
  }

  // Función para volver a la página de login
  goBack(): void {
    this.router.navigate(['/auth/login']);
  }
}