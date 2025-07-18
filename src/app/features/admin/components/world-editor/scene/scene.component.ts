import { AfterViewInit, Component, ElementRef, Input, Output, EventEmitter, OnDestroy, ViewChild } from '@angular/core';
import { EngineService } from '../service/three-engine/engine.service';
import { SceneObjectResponse } from '../../../services/admin.service';
import { CommonModule } from '@angular/common';


@Component({
  selector: 'app-scene',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scene.component.html',
  styleUrls: ['./scene.component.css']
})
export class SceneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('sceneCanvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() initialObjects: SceneObjectResponse[] = [];
  @Output() loadingProgress = new EventEmitter<number>();
  @Output() loadingComplete = new EventEmitter<void>();

  constructor(
    private engineService: EngineService
  ) { }

  ngAfterViewInit(): void {
    if (!this.canvasRef) {
      console.error("No se pudo obtener la referencia al canvas.");
      return;
    }

    this.engineService.init(
      this.canvasRef,
      this.initialObjects,
      (progress) => this.loadingProgress.emit(progress),
      () => this.loadingComplete.emit()
    );
  }

  ngOnDestroy(): void {
    console.log('[SceneComponent] Destruyendo la instancia del motor 3D.');
    // --- CORRECCIÓN ---
    // En lugar de llamar a un método 'destroy' que no existe, llamamos al ciclo de vida ngOnDestroy del servicio.
    this.engineService.ngOnDestroy();
  }
}