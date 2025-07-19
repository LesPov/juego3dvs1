// src/app/features/admin/components/world-editor/toolbar/toolbar.component.ts

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EngineService } from '../service/three-engine/engine.service';

// ✅ CAMBIO: Hemos añadido 'move' y eliminado 'translate' para mayor claridad.
// 'move' usará el helper interactivo.
// 'helper' queda reservado para una futura visualización de ejes no interactiva.
export type ToolMode = 'select' | 'move' | 'rotate' | 'scale' | 'helper';

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
    if (this.activeTool === tool) {
      this.activeTool = 'select';
    } else {
      this.activeTool = tool;
    }
    
    this.engineService.setToolMode(this.activeTool);
    
    console.log(`[Toolbar] Herramienta cambiada a: ${this.activeTool}`);
  }
}