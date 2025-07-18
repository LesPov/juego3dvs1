// ARCHIVO: verify-number.component.ts (COMPLETO Y MEJORADO)

import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { authService } from '../../services/auths';

@Component({
  selector: 'app-verify-number',
  standalone: true, // Lo hacemos standalone para seguir las prácticas modernas
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './verify-number.component.html',
  styleUrls: ['./verify-number.component.css']
})
export class VerifyNumberComponent implements OnInit, OnDestroy {
  username: string = '';
  phoneNumber: string = '';
  verificationDigits: string[] = Array(6).fill('');

  // Estados de carga más específicos para una UI más clara
  isLoading: boolean = false;
  isResending: boolean = false;
  showConfirmationMessage: boolean = false;

  // Lógica del temporizador
  timeLeft: number = 120; // 2 minutos
  interval: any;
  timerVisible: boolean = false;

  constructor(
    private authService: authService,
    private route: ActivatedRoute,
    private location: Location,
    private toastr: ToastrService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.username = params['username'] || '';
      // Asumimos que el número ya viene en el formato que necesitas desde el paso anterior
      this.phoneNumber = params['phoneNumber'] || '';

      if (this.username && this.phoneNumber) {
        this.startTimer();
      } else {
        // Medida de seguridad: si no hay datos, no debería estar aquí
        this.toastr.warning('Datos incompletos. Volviendo al inicio.', 'Atención');
        this.router.navigate(['/auth/login']);
      }
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.interval);
  }

  goBack(): void {
    this.location.back();
  }

  showConfirmationDialog(): void {
    this.showConfirmationMessage = true;
  }

  // Lógica de inputs mejorada, igual que en la verificación de email para consistencia
  handleKeyUp(event: KeyboardEvent, currentInput: HTMLInputElement, prevInput: HTMLInputElement | null, nextInput: HTMLInputElement | null): void {
    if (event.key === 'Backspace' && currentInput.value === '' && prevInput) {
      prevInput.focus();
      return;
    }
    
    if (currentInput.value.length === 1 && nextInput) {
      if (/^[0-9]$/.test(currentInput.value)) {
        nextInput.focus();
      } else {
        currentInput.value = ''; // Limpia si no es un número
      }
    }
    
    // Si se llena el último dígito, intenta verificar automáticamente
    if (currentInput.value.length === 1 && !nextInput) {
      if (this.verificationDigits.every(d => d && /^[0-9]$/.test(d))) {
        this.verifyCode();
      }
    }
  }

  // Función para deshabilitar el botón de verificación si el código está incompleto
  isVerifyButtonDisabled(): boolean {
    return this.verificationDigits.some(d => d === '' || !/^[0-9]$/.test(d));
  }

  verifyCode(): void {
    if (this.isVerifyButtonDisabled() || this.isLoading) {
      return;
    }

    this.isLoading = true;
    const fullCode = this.verificationDigits.join('');

    // Usamos la sintaxis moderna de .subscribe
    this.authService.verifyPhoneNumber(this.username, this.phoneNumber, fullCode).subscribe({
      next: () => {
        this.isLoading = false;
        this.toastr.success('¡Número de teléfono verificado!', 'Éxito');
        this.router.navigate(['/auth/login']); // O a la ruta final que desees
      },
      error: (err: HttpErrorResponse) => {
        this.isLoading = false;
        this.toastr.error(err.error?.msg || 'Código incorrecto o expirado.', 'Error');
        this.verificationDigits = Array(6).fill(''); // Limpiar inputs en error
      }
    });
  }

  resendVerificationCode(): void {
    if (this.isResending) return;

    this.isResending = true;
    this.authService.resendVerificationPhone(this.username, this.phoneNumber).subscribe({
      next: () => {
        this.isResending = false;
        this.toastr.success('Se ha reenviado un nuevo código a tu teléfono.', 'Éxito');
        this.verificationDigits = Array(6).fill('');
        this.timeLeft = 120;
        this.startTimer();
      },
      error: () => {
        this.isResending = false;
        this.toastr.error('No se pudo reenviar el código. Inténtalo de nuevo.', 'Error');
      }
    });
  }

  startTimer(): void {
    if (this.interval) clearInterval(this.interval); // Limpia cualquier timer anterior
    this.timerVisible = true;
    this.interval = setInterval(() => {
      if (this.timeLeft > 0) {
        this.timeLeft--;
      } else {
        this.timerVisible = false;
        clearInterval(this.interval);
      }
    }, 1000);
  }

  formatTimeLeft(): string {
    const minutes = Math.floor(this.timeLeft / 60);
    const seconds = this.timeLeft % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  // Función para mostrar el número de teléfono parcialmente oculto
  getMaskedPhoneNumber(): string {
    if (this.phoneNumber.length > 4) {
      const lastFour = this.phoneNumber.slice(-4);
      return `*****${lastFour}`;
    }
    return this.phoneNumber; // Devuelve el número tal cual si es muy corto
  }
}