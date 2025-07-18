import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { authService } from '../../services/auths';

interface Country {
  name: string;
  countryCode: string;
}

@Component({
  selector: 'app-number',
  imports: [CommonModule, FormsModule],
  templateUrl: './number.component.html',
  styleUrls: ['./number.component.css']
})
export class NumberComponent implements OnInit {
  username: string = '';
  selectedCountryCode: string | null = null;
  phoneNumber: string = '';
  isLoading: boolean = false;
  showConfirmationMessage: boolean = false;
  countries: Country[] = [];

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
      if (!this.username) {
        this.toastr.warning('Usuario no encontrado, volviendo al inicio.', 'Atención');
        this.router.navigate(['/auth/login']);
      }
    });

    this.loadCountries();
  }

  goBack(): void {
    this.location.back();
  }

  loadCountries() {
    this.authService.getCountries().subscribe({
      next: (countries: Country[]) => {
        this.countries = countries;
      },
      error: () => {
        this.toastr.error('No se pudo cargar la lista de países.', 'Error de Red');
      }
    });
  }
  
  showConfirmationDialog(): void {
    this.showConfirmationMessage = true;
  }

  registerPhoneNumber() {
    if (!this.selectedCountryCode || !this.phoneNumber) {
      this.toastr.error('Por favor, selecciona un país e ingresa un número válido.', 'Error');
      return;
    }
  
    this.isLoading = true;
    const formattedPhoneNumber = this.selectedCountryCode + this.phoneNumber.replace(/\D/g, '');

    this.authService.registerPhoneNumber(this.username, formattedPhoneNumber).subscribe({
      next: () => {
        this.isLoading = false;
        this.toastr.success('Se ha enviado un código de verificación a tu teléfono.', 'Éxito');
        this.router.navigate(['/auth/verifynumber'], { 
          queryParams: { 
            username: this.username, 
            phoneNumber: formattedPhoneNumber 
          } 
        });
      },
      error: (err: HttpErrorResponse) => {
        this.isLoading = false;
        this.toastr.error(err.error?.msg || 'Error al enviar el código de verificación.', 'Error');
      }
    });
  }
}