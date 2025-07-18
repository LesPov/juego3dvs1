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
   * Muestra el panel de estadísticas en la pantalla.
   */
  public init(): void {
    // Posicionamos el panel. El top de 40px es para que quede debajo de tu header.
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.top = '40px'; // Debajo del editor-header
    this.stats.dom.style.left = '0px';
    this.stats.dom.style.zIndex = '100'; // Asegura que esté por encima del canvas

    document.body.appendChild(this.stats.dom);
  }

  /**
   * Debe ser llamado al inicio de cada frame del bucle de animación.
   */
  public begin(): void {
    this.stats.begin();
  }

  /**
   * Debe ser llamado al final de cada frame del bule de animación.
   */
  public end(): void {
    this.stats.end();
  }

  /**
   * Elimina el panel de estadísticas del DOM para limpiar.
   */
  public destroy(): void {
    if (this.stats.dom && document.body.contains(this.stats.dom)) {
      document.body.removeChild(this.stats.dom);
    }
  }
}