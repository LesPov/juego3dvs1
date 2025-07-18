import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { BotInfoService } from '../../../admin/services/botInfo.service';
import { ProfileService } from '../../../profile/services/profileServices';

@Component({
  selector: 'app-info-register',
  imports: [],
  templateUrl: './info-register.component.html',
  styleUrl: './info-register.component.css'
})
export class InfoRegisterComponent implements OnInit {
  // Lista de mensajes para la ayuda del bot
  private inforegisterList: string[] = [
    "Estás viendo una imagen que representa la comunidad campesina, base fundamental de CampiAmigo.",
    "Para completar tu registro como CampiAmigo, se realizará un proceso en dos etapas: la digital y la personal.",
    "En la etapa digital, recopilaremos y verificaremos tus datos a través de la plataforma.",
    "Posteriormente, en la etapa personal, revisaremos en detalle tu información de manera presencial.",
    "Una vez finalizado este registro personal, se llevará a cabo un estudio y en un plazo máximo de 10 días recibirás una respuesta.",
    "Pulsa el botón 'Aceptar' para continuar con el proceso de registro."
  ];
  
  // (Opcional) Puedes almacenar la información del perfil, pero sin redirigir ni mostrar mensajes aún.
  isRegistered: boolean = false;

  constructor(
    private botInfoService: BotInfoService,
    private router: Router, 
    private profileService: ProfileService,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    // Solo se establece la info para el bot, sin validación inmediata
    this.botInfoService.setInfoList(this.inforegisterList);
    // Si deseas almacenar el valor sin mostrar mensaje, puedes hacerlo, pero no redirigir aquí:
    this.profileService.getProfile().subscribe(
      profile => {
        if (profile && profile.campiamigo) {
          this.isRegistered = true;
        }
      },
      error => {
        console.error('Error al obtener el perfil:', error);
      }
    );
  }

  // Este método se ejecuta al pulsar "Aceptar"
  irAUbicacion(): void {
    // Se consulta el perfil para validar en ese momento
    this.profileService.getProfile().subscribe(
      profile => {
        if (profile && profile.campiamigo) {
          // Si el campo campiamigo es true, mostramos el mensaje y redirigimos al Dashboard
          this.toastr.info('Ya estás registrado, redirigiendo al Dashboard.');
          this.router.navigate(['/user/dashboard']);
        } else {
          // De lo contrario, se continúa al proceso de registro (ruta de ubicación)
          this.router.navigate(['/user/ubicacion']);
        }
      },
      error => {
        console.error('Error al obtener el perfil:', error);
        // En caso de error, se podría optar por dejarlo pasar o mostrar un mensaje de error
        this.router.navigate(['/user/ubicacion']);
      }
    );
  }
}
