// src/app/features/admin/components/world-editor/toolbar/toolbar.component.ts

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EngineService } from '../service/three-engine/engine.service';
 
// Se añaden los nuevos modos que podrían ser necesarios en el futuro
export type ToolMode = 'select' | 'move' | 'rotate' | 'scale' | 'helper' | 'camera' | 'frame' | 'maximize';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.css']
})
export class ToolbarComponent {

  activeTool: ToolMode = 'select';
  // ✅ MEJORA: Estado para el botón de maximizar
  isMaximized: boolean = false;

  constructor(private engineService: EngineService) { }

  setTool(tool: ToolMode): void {
    if (this.activeTool === tool) {
      // Si se hace clic en la misma herramienta, se vuelve a 'select'
      this.activeTool = 'select';
    } else {
      this.activeTool = tool;
    }
    this.engineService.setToolMode(this.activeTool);
    console.log(`[Toolbar] Herramienta de transformación cambiada a: ${this.activeTool}`);
  }

  // ✅ MEJORA: Lógica para el botón de maximizar/minimizar
  toggleMaximize(): void {
    this.isMaximized = !this.isMaximized;
    // Aquí iría la lógica para expandir el viewport
    console.log(`[Toolbar] Vista maximizada: ${this.isMaximized}`);
  }

  // ✅ MEJORA: Lógica para el botón de cámara
  toggleCamera(): void {
    this.engineService.toggleCameraMode();
    console.log(`[Toolbar] Modo de cámara cambiado.`);
  }

  // ✅ MEJORA: Lógica para el botón de encuadrar
  frameAll(): void {
    // Asumimos que el engine service tiene un método para encuadrar la escena completa
    this.engineService.frameScene(1000, 1000); // Valores de ejemplo
    console.log(`[Toolbar] Encuadrando la escena.`);
  }
}