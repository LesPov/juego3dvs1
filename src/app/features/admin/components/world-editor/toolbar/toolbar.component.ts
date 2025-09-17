// src/app/features/admin/components/world-editor/toolbar/toolbar.component.ts
import { Component, EventEmitter, Output, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EngineService } from '../service/three-engine/core/engine.service';
 
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
  
  @Input() isMaximized: boolean = false;
  
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

  toggleMaximize(): void {
    this.maximizeToggle.emit();
  }

  toggleCamera(): void {
    this.engineService.toggleCameraMode();
  }

  // ✅ MEJORA: La función ahora es más simple. La lógica compleja se mueve al servicio.
  frameAll(): void {
    this.engineService.frameScene();
  }
}