import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';

interface StoreUrls {
  ios: string;
  android: string;
}

@Component({
  selector: 'app-prompt-banner',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './app-prompt-banner.component.html',
  styleUrls: ['./app-prompt-banner.component.css']
})
export class AppPromptBannerComponent implements OnInit, OnDestroy {
  @Input() appName: string = 'nuestra app';
  @Input() appId: string = 'com.agrored.app';
  @Input() storeUrls: StoreUrls = {
    ios: 'https://apps.apple.com/app/tu-app/idXXXXXXXXX',
    android: `https://play.google.com/store/apps/details?id=${this.appId}`
  };
  @Input() apkUrl: string = 'assets/apk/agrored.apk';
  // === CAMBIO CLAVE N°1 ===
  // Nueva propiedad para definir cuánto tiempo (en milisegundos) estará visible el banner.
  // 60000 ms = 1 minuto.
  @Input() autoDismissTime: number = 60000;

  @Output() dismiss = new EventEmitter<void>();

  isIOS: boolean = false;
  private fallbackTimeout: any;
  // === CAMBIO CLAVE N°2 ===
  // Variable para guardar la referencia al temporizador de auto-cierre.
  private autoDismissTimeout: any;

  constructor(private router: Router, private http: HttpClient) {}

  ngOnInit(): void {
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    // === CAMBIO CLAVE N°3 ===
    // Iniciamos el temporizador para cerrar el banner automáticamente.
    this.startAutoDismissTimer();
  }

  ngOnDestroy(): void {
    // === CAMBIO CLAVE N°4 ===
    // Limpiamos AMBOS temporizadores para evitar fugas de memoria.
    clearTimeout(this.fallbackTimeout);
    clearTimeout(this.autoDismissTimeout);
  }

  // === CAMBIO CLAVE N°5 ===
  // Nueva función para iniciar el temporizador.
  private startAutoDismissTimer(): void {
    console.log(`El banner se cerrará automáticamente en ${this.autoDismissTime / 1000} segundos.`);
    this.autoDismissTimeout = setTimeout(() => {
      console.log('Tiempo de auto-cierre agotado. Cerrando el banner.');
      // Emitimos el mismo evento que si el usuario hiciera clic en la 'X'.
      this.dismiss.emit();
    }, this.autoDismissTime);
  }

  closeBanner(event: Event): void {
    event.stopPropagation();
    // === CAMBIO CLAVE N°6 ===
    // Antes de emitir, cancelamos el temporizador de auto-cierre para que no se ejecute innecesariamente.
    clearTimeout(this.autoDismissTimeout);
    this.dismiss.emit();
  }

  openAppOrStore(): void {
    // === CAMBIO CLAVE N°7 ===
    // También cancelamos el temporizador si el usuario interactúa con el botón principal.
    clearTimeout(this.autoDismissTimeout);

    const currentUrl = this.router.url;
    const deepLink = `${this.appId}://app${currentUrl}`;

    console.log('Intentando abrir Deep Link dinámico:', deepLink);
    window.location.href = deepLink;

    this.fallbackTimeout = setTimeout(() => {
      if (!document.hidden) {
        if (this.isIOS) {
          console.log('Fallback en iOS: Redirigiendo a la App Store.');
          window.location.href = this.storeUrls.ios;
        } else {
          console.log('Fallback en Android: Iniciando descarga directa del APK.');
          this.downloadApk();
        }
      }
    }, 2500);
  }

  private downloadApk(): void {
    this.http.get(this.apkUrl, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'agrored.apk';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        console.log('Descarga del APK iniciada correctamente.');
      },
      error: (err) => {
        console.error('Error al descargar el archivo APK:', err);
        alert('No se pudo descargar la aplicación. Serás redirigido a la Play Store.');
        window.location.href = this.storeUrls.android;
      }
    });
  }
}