import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { BotInfoService } from '../../../admin/services/botInfo.service';
import { ProfileService } from '../../../profile/services/profileServices';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-registro-campiamigo',
  imports: [CommonModule,FormsModule],
  templateUrl: './registro-campiamigo.component.html',
  styleUrl: './registro-campiamigo.component.css'
})
export class RegistroCampiamigoComponent implements OnInit {
  isModified: boolean = false;
  private inforegisterCampiamigo: string[] = [
    "Bienvenido al registro de Campi Amigo",
 
  ];

  // Objeto para almacenar los datos a actualizar
  minimalProfileData: {
    identificationType: string;
    identificationNumber: string;
    direccion: string;
    campiamigo: boolean;
  } = {
    identificationType: '',
    identificationNumber: '',
    direccion: '',
    campiamigo: false
  };

  identificationTypes: string[] = [
    'Cédula',
    'Tarjeta de Identidad',
    'DNI',
    'Pasaporte',
    'Licencia de Conducir',
    'Otro'
  ];

  constructor(
    private profileService: ProfileService,
    private router: Router,
    private toastr: ToastrService,
        private botInfoService: BotInfoService,
    
  ) {}

  ngOnInit(): void {
    this.botInfoService.setInfoList(this.inforegisterCampiamigo);
    const storedLocation = localStorage.getItem('userLocation');
    if (storedLocation) {
      try {
        const userLocation = JSON.parse(storedLocation);
        if (userLocation.direccion) {
          this.minimalProfileData.direccion = userLocation.direccion;
          // Opcional: Marcar el formulario como modificado al recuperar datos
          this.isModified = true;
        }
      } catch (error) {
        console.error('Error al parsear la ubicación almacenada', error);
      }
    }
  }

  // Marca que hubo un cambio en el formulario
  setModified(): void {
    this.isModified = true;
  }

  updateMinimalProfile(): void {
    if (
      !this.minimalProfileData.identificationType ||
      !this.minimalProfileData.identificationNumber ||
      !this.minimalProfileData.direccion
    ) {
      this.toastr.error('Todos los campos son obligatorios', 'Error');
      return;
    }
    
    if (!this.minimalProfileData.campiamigo) {
      this.toastr.error('El campo Campiamigo debe estar activado', 'Error');
      return;
    }
    
    this.profileService.updateMinimalProfile(this.minimalProfileData).subscribe({
      next: (res) => {
        this.toastr.success('Perfil actualizado exitosamente', 'Éxito');
        this.router.navigate(['/user/dashboard']);
      },
      error: (err) => {
        this.toastr.error(err.error.msg || 'Error al actualizar el perfil', 'Error');
      }
    });
  }
}
