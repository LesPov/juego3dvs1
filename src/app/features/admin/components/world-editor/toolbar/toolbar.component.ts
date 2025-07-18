// src/app/features/admin/components/world-editor/toolbar/toolbar.component.ts

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EngineService } from '../service/three-engine/engine.service';

export type ToolMode = 'select' | 'helper' | 'translate' | 'rotate' | 'scale';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.css']
})
export class ToolbarComponent {
  
  activeTool: ToolMode = 'select';

  constructor(private engineService: EngineService) { }

  setTool(tool: ToolMode): void {
    // Lógica para deseleccionar si se pulsa la misma herramienta
    if (this.activeTool === tool) {
      this.activeTool = 'select'; // Vuelve al modo de selección por defecto
    } else {
      this.activeTool = tool;
    }

    // Informa al EngineService del cambio de herramienta
    this.engineService.setToolMode(this.activeTool);
    
    console.log(`[Toolbar] Herramienta cambiada a: ${this.activeTool}`);
  }
}