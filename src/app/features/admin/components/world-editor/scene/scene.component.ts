// RUTA: src/app/features/admin/views/world-editor/world-editor/scene/scene.component.ts

import { AfterViewInit, Component, ElementRef, Input, Output, EventEmitter, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SceneObjectResponse } from '../../../services/admin.service';
import { EngineService } from '../service/three-engine/engine.service';

@Component({
  selector: 'app-scene',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scene.component.html',
  styleUrls: ['./scene.component.css']
})
export class SceneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('sceneCanvas') private canvasRef!: ElementRef<HTMLCanvasElement>;
  
  @Input() initialObjects: SceneObjectResponse[] = [];
  @Output() loadingProgress = new EventEmitter<number>();
  @Output() loadingComplete = new EventEmitter<void>();

  // ✅ NUEVO: Declaramos el ResizeObserver
  private resizeObserver!: ResizeObserver;

  constructor(private engineService: EngineService) {}

  ngAfterViewInit(): void {
    if (!this.canvasRef) {
      console.error("[SceneComponent] No se pudo obtener la referencia al canvas.");
      return;
    }

    this.engineService.init(this.canvasRef);
    console.log('[SceneComponent] El motor 3D ha sido inicializado.');

    // ✅ NUEVO: Configuramos el ResizeObserver después de inicializar el motor
    this.setupResizeObserver();

    if (this.initialObjects && this.initialObjects.length > 0) {
      this.engineService.populateScene(
        this.initialObjects,
        (progress: number) => this.loadingProgress.emit(progress),
        () => this.loadingComplete.emit()
      );
    } else {
      this.loadingComplete.emit();
    }
  }
  
  // ✅ NUEVO: Método para configurar el observador
  private setupResizeObserver(): void {
    const container = this.canvasRef.nativeElement.parentElement;
    if (!container) return;

    this.resizeObserver = new ResizeObserver(() => {
      // Cada vez que el contenedor cambie de tamaño, llamamos al redimensionador del motor.
      // ¡Esto es lo que hace la transición suave!
      this.engineService.onWindowResize();
    });

    // Empezamos a observar el contenedor del canvas.
    this.resizeObserver.observe(container);
  }

  ngOnDestroy(): void {
    console.log('[SceneComponent] Destruyendo la instancia del motor 3D.');
    
    // ✅ NUEVO: Es muy importante desconectar el observador para evitar fugas de memoria.
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.engineService.ngOnDestroy();
  }
}