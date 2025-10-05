// src/app/features/admin/components/world-editor/service/three-engine/utils/stats-manager.service.ts

import { Injectable } from '@angular/core';
import Stats from 'stats.js';

@Injectable({
  providedIn: 'root'
})
export class StatsManagerService {
  private stats: Stats;

  constructor() {
    this.stats = new Stats();
  }

  /**
   * Inicializa y muestra el panel de estadísticas dentro de un contenedor específico.
   * @param containerId El ID del elemento HTML que contendrá las estadísticas.
   */
  public init(containerId: string): void {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[StatsManagerService] El contenedor con ID '${containerId}' no fue encontrado.`);
      return;
    }

    // Adaptamos los estilos del contenedor principal de stats.js para que ocupe todo el espacio.
    this.stats.dom.style.position = 'relative';
    this.stats.dom.style.top = '0';
    this.stats.dom.style.left = '0';
    this.stats.dom.style.width = '100%';
    this.stats.dom.style.height = '100%';
    this.stats.dom.style.zIndex = 'auto';

    // La librería stats.js aplica estilos en línea a los canvas con un tamaño fijo.
    // Para que ocupen el 100%, necesitamos sobreescribir esos estilos directamente.
    const canvases = this.stats.dom.querySelectorAll('canvas');
    canvases.forEach(canvas => {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
    });

    container.appendChild(this.stats.dom);
  }

  /**
   * Debe ser llamado al inicio de cada frame del bucle de animación.
   */
  public begin(): void {
    this.stats.begin();
  }

  /**
   * Debe ser llamado al final de cada frame del bucle de animación.
   */
  public end(): void {
    this.stats.end();
  }

  /**
   * Elimina el panel de estadísticas del DOM para limpiar.
   */
  public destroy(): void {
    if (this.stats.dom && this.stats.dom.parentElement) {
      this.stats.dom.parentElement.removeChild(this.stats.dom);
    }
  }
}