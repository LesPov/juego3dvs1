import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { authService } from '../../services/auths';

@Component({
  selector: 'app-email',
  // standalone: true, // Si es standalone
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './email.component.html',
  styleUrls: ['./email.component.css'] // Corregido a styleUrls
})
export class EmailComponent implements OnInit, OnDestroy {
  username: string = '';
  verificationDigits: string[] = Array(6).fill('');
  
  isLoading: boolean = false;
  isResending: boolean = false;
  showConfirmationMessage: boolean = false;
  
  timeLeft: number = 120;
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
      if (this.username) {
        this.startTimer();
      } else {
        this.toastr.warning('Usuario no encontrado. Volviendo al registro.', 'Atención');
        this.router.navigate(['/auth/register']);
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

  // TU LÓGICA ORIGINAL RESTAURADA Y PERFECCIONADA
  handleKeyUp(event: KeyboardEvent, currentInput: HTMLInputElement, prevInput: HTMLInputElement | null, nextInput: HTMLInputElement | null): void {
    // Si se presiona Backspace y el input actual está vacío, mover el foco hacia atrás
    if (event.key === 'Backspace' && currentInput.value === '' && prevInput) {
      prevInput.focus();
      return;
    }
    
    // Si se ingresa un dígito (y no es Backspace), mover el foco hacia adelante
    if (currentInput.value.length === 1 && nextInput) {
      // Usamos una expresión regular para asegurar que solo números avancen el foco
      if (/^[0-9]$/.test(currentInput.value)) {
        nextInput.focus();
      } else {
        // Si no es un número, lo borramos.
        currentInput.value = '';
      }
    }
    
    // Si se ha llenado el último dígito, intentar verificar el código
    if (currentInput.value.length === 1 && !nextInput) {
      if (this.verificationDigits.every(d => d && /^[0-9]$/.test(d))) {
        this.verifyCode();
      }
    }
  }

  isVerifyButtonDisabled(): boolean {
    return this.verificationDigits.some(d => d === '' || !/^[0-9]$/.test(d));
  }

  verifyCode(): void {
    if (this.isVerifyButtonDisabled() || this.isLoading) {
      return; // No hacer nada si ya está cargando o el código está incompleto
    }

    this.isLoading = true;
    const fullCode = this.verificationDigits.join('');

    this.authService.verifyEmail(this.username, fullCode).subscribe({
      next: () => {
        this.isLoading = false;
        this.toastr.success('¡Correo verificado con éxito!', 'Éxito');
        this.router.navigate(['/auth/number'], { queryParams: { username: this.username } });
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
    this.authService.resendVerificationEmail(this.username).subscribe({
      next: () => {
        this.isResending = false;
        this.toastr.success('Se ha reenviado un nuevo código.', 'Éxito');
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
}