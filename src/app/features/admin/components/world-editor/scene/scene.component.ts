import { AfterViewInit, Component, ElementRef, Input, Output, EventEmitter, OnDestroy, ViewChild, OnChanges, SimpleChanges } from '@angular/core';
import { SceneObjectResponse } from '../../../services/admin.service';
import { CommonModule } from '@angular/common';
import { EngineService } from '../service/three-engine/engine.service';

@Component({
  selector: 'app-scene',
  standalone: true,
  imports: [CommonModule],
  template: '<canvas #sceneCanvas class="scene-canvas"></canvas>',
  styleUrls: ['./scene.component.css']
})
export class SceneComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('sceneCanvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() initialObjects: SceneObjectResponse[] | null = []; // Acepta null del async pipe
  @Output() loadingProgress = new EventEmitter<number>();
  @Output() loadingComplete = new EventEmitter<void>();

  private isEngineInitialized = false;

  constructor(
    private engineService: EngineService
  ) { }

  ngAfterViewInit(): void {
    if (!this.canvasRef) {
      console.error("[SceneComponent] No se pudo obtener la referencia al canvas.");
      return;
    }
    
    // 1. Inicializamos el motor 3D con la escena vacía.
    this.engineService.init(this.canvasRef);
    this.isEngineInitialized = true;
    console.log('[SceneComponent] El motor 3D ha sido inicializado.');
    
    // 2. Si los datos llegaron antes de que la vista se creara, los poblamos ahora.
    if (this.initialObjects && this.initialObjects.length > 0) {
      this.engineService.populateScene(
        this.initialObjects,
        (progress) => this.loadingProgress.emit(progress),
        () => this.loadingComplete.emit()
      );
    }
  }

  // 3. Este hook reacciona cuando los datos llegan DESPUÉS de que la vista se creó.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialObjects'] && this.isEngineInitialized) {
      const newObjects = changes['initialObjects'].currentValue;

      if (newObjects && Array.isArray(newObjects) && newObjects.length > 0) {
        console.log(`[SceneComponent] ngOnChanges detectó ${newObjects.length} objetos. Repoblando la escena...`);
        this.engineService.populateScene(
          newObjects,
          (progress) => this.loadingProgress.emit(progress),
          () => this.loadingComplete.emit()
        );
      }
    }
  }

  ngOnDestroy(): void {
    console.log('[SceneComponent] Destruyendo la instancia del motor 3D.');
    this.engineService.ngOnDestroy();
  }
}