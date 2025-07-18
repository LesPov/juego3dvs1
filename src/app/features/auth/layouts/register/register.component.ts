import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { auth } from '../../interfaces/auth';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { authService } from '../../services/auths';

@Component({
  selector: 'app-register',
  // standalone: true, // Descomenta si tu componente es standalone
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent implements OnInit {
  user: auth = {
    username: '',
    password: '',
    email: '',
    rol: 'user',
  };
  confirmPassword: string = '';
  isLoading: boolean = false; // <-- CAMBIO 1: Propiedad para controlar el spinner

  constructor(
    private toastr: ToastrService,
    private location: Location,
    private authService: authService,
    private router: Router
  ) { }

  ngOnInit(): void { }

  goBack(): void {
    this.location.back();
  }

  addUser() {
    // Las validaciones iniciales están perfectas
    if (
      !this.user.email ||
      !this.user.username ||
      !this.user.password ||
      !this.confirmPassword
    ) {
      this.toastr.error('Todos los campos son obligatorios', 'Error');
      return;
    }

    if (this.user.password !== this.confirmPassword) {
      this.toastr.error('Las contraseñas no coinciden', 'Error');
      return;
    }

    this.isLoading = true; // <-- CAMBIO 2: Inicia la carga ANTES de llamar al servicio

    // Usamos la sintaxis moderna de .subscribe con un objeto para mayor claridad
    this.authService.register(this.user).subscribe({
      next: () => {
        // Éxito en la petición
        this.isLoading = false; // <-- CAMBIO 3: Detiene la carga al tener éxito
        this.toastr.success(`El usuario ${this.user.username} fue registrado con éxito`, '¡Registro Exitoso!');

        // MANTENEMOS TU LÓGICA CLAVE: Redirigir con el username en la URL
        this.router.navigate(['/auth/email'], { queryParams: { username: this.user.username } });
      },
      error: (error: HttpErrorResponse) => {
        // Error en la petición
        this.isLoading = false; // <-- CAMBIO 4: Detiene la carga también si hay error

        // Lógica de error mejorada para ser más segura
        const errorMessage = error.error?.msg || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
        this.toastr.error(errorMessage, 'Error en el Registro');
      }
    });
  }
}