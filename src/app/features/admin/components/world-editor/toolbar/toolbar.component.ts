// src/app/features/admin/components/world-editor/toolbar/toolbar.component.ts
import { Component, EventEmitter, Output, Input } from '@angular/core'; // ✅ Importar Input
import { CommonModule } from '@angular/common';
import { EngineService } from '../service/three-engine/engine.service';
 
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
  
  // ✅ LÓGICA MEJORADA: Recibe el estado desde el padre para mantener el ícono sincronizado.
  @Input() isMaximized: boolean = false;
  
  // Emite el evento para notificar al padre que se quiere maximizar/restaurar.
  @Output() maximizeToggle = new EventEmitter<void>();

  constructor(private engineService: EngineService) { }

  setTool(tool: ToolMode): void {
    if (this.activeTool === tool) {
      this.activeTool = 'select';
    } else {
      this.activeTool = tool;
    }
    this.engineService.setToolMode(this.activeTool);
  }

  // Emite el evento al componente padre. Ya no necesita gestionar su propio estado.
  toggleMaximize(): void {
    this.maximizeToggle.emit();
  }

  toggleCamera(): void {
    this.engineService.toggleCameraMode();
  }

  frameAll(): void {
    this.engineService.frameScene(1000, 1000);
  }
}