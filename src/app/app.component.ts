import { Component, OnInit, NgZone } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { AppPromptBannerComponent } from './shared/app-prompt-banner/app-prompt-banner.component';
 
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, AppPromptBannerComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  showAppPrompt = false;
  appId = 'com.agrored.app';
  storeLinks = {
    ios: 'https://apps.apple.com/app/tu-app/idXXXXXXXXX',
    android: `https://play.google.com/store/apps/details?id=${this.appId}`
  };

  constructor(private router: Router, private zone: NgZone) {}

  ngOnInit() {
    this.checkIfShowAppPrompt();
    this.initializeAppListeners(); // Inicializamos los listeners y el chequeo de lanzamiento
  }

  // == LÓGICA MEJORADA PARA MANEJAR DEEP LINKS ==
  initializeAppListeners() {
    if (!Capacitor.isNativePlatform()) {
      return; // No hagas nada si no estás en la app nativa
    }

    // 1. Listener para cuando la app YA ESTÁ ABIERTA y recibe un nuevo link
    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      this.handleDeepLink(event.url);
    });

    // 2. Comprobar si la app FUE INICIADA por un deep link
    App.getLaunchUrl().then(launchUrl => {
      if (launchUrl && launchUrl.url) {
        this.handleDeepLink(launchUrl.url);
      }
    });
  }

  /**
   * Función centralizada para procesar cualquier URL de Deep Link.
   * @param deepLinkUrl La URL completa (ej: com.agrored.app://app/auth/...)
   */
  private handleDeepLink(deepLinkUrl: string) {
    this.zone.run(() => {
      // La URL completa del deep link será algo como:
      // com.agrored.app://app/auth/verifynumber?username=...

      // Creamos un objeto URL para analizarla fácilmente
      const url = new URL(deepLinkUrl);

      // Extraemos el pathname y el search
      // url.pathname será '/auth/verifynumber'
      // url.search será '?username=...'
      const routePath = url.pathname + url.search;
      
      console.log(`Deep Link procesado, navegando a: ${routePath}`);
      
      // Le decimos al Router de Angular que navegue a esa ruta
      this.router.navigateByUrl(routePath, { replaceUrl: true }); // replaceUrl es buena práctica aquí
    });
  }

  checkIfShowAppPrompt(): void {
    if (Capacitor.isNativePlatform() || sessionStorage.getItem('appPromptDismissed') === 'true') {
      return;
    }
    const isMobile = /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      this.showAppPrompt = true;
    }
  }

  dismissAppPrompt(): void {
    this.showAppPrompt = false;
    sessionStorage.setItem('appPromptDismissed', 'true');
  }
}