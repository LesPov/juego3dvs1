// CÓDIGO TS COMPLETO Y CORRECTO (Sin cambios lógicos necesarios)

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { authService } from '../../../services/auths';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-reset-password-recovery',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reset-password-recovery.component.html',
  styleUrls: ['./reset-password-recovery.component.css']
})
export class ResetPasswordRecoveryComponent implements OnInit {
  // Datos del formulario (inician vacíos, como debe ser)
  randomPassword = '';
  newPassword = '';
  confirmNewPassword = '';
  
  // Datos necesarios para la API (obtenidos de la URL)
  private usernameOrEmail = '';
  private token = '';
  
  // Estados de la UI
  isLoading = false;
  showPassword = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: authService,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    this.usernameOrEmail = this.route.snapshot.queryParamMap.get('username') || '';

    if (!this.token || !this.usernameOrEmail) {
      this.toastr.error('Enlace inválido o expirado. Por favor, solicita la recuperación de nuevo.', 'Error de Validación');
      this.router.navigate(['/auth/passwordrecovery']);
    }
  }

  resetPassword(): void {
    if (!this.randomPassword || !this.newPassword || !this.confirmNewPassword) {
        this.toastr.error('Por favor, completa todos los campos.', 'Campos Incompletos');
        return;
    }
    if (this.newPassword !== this.confirmNewPassword) {
      this.toastr.error('Las contraseñas no coinciden.', 'Error de Verificación');
      return;
    }

    this.isLoading = true;

    this.authService.resetPassword(this.usernameOrEmail, this.randomPassword, this.newPassword, this.token)
      .pipe(
        finalize(() => this.isLoading = false)
      )
      .subscribe({
        next: () => {
          this.toastr.success('¡Tu contraseña ha sido actualizada con éxito!', 'Operación Completada');
          this.router.navigate(['/auth/login']);
        },
        error: (err: HttpErrorResponse) => {
          const errorMsg = err.error?.msg || 'El código es incorrecto o el enlace ha expirado.';
          this.toastr.error(errorMsg, 'Error al Restablecer');
        }
      });
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }
  
  goBack(): void {
    this.router.navigate(['/auth/login']);
  }
}