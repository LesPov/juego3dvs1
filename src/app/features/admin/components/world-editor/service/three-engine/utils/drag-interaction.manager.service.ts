// src/app/features/admin/components/world-editor/service/three-engine/utils/drag-interaction.manager.service.ts
import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { Subject } from 'rxjs';
import { ControlsManagerService } from './controls-manager.service';
import { InteractionHelperManagerService } from './interaction-helper.manager.service';

@Injectable({
  providedIn: 'root'
})
export class DragInteractionManagerService {
  private camera!: THREE.Camera;
  private canvas!: HTMLCanvasElement;
  private controlsManager!: ControlsManagerService;

  private isDragging = false;
  private selectedObject: THREE.Object3D | null = null;
  private interactionPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private intersectionPoint = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  
  private axisConstraint: 'x' | 'y' | 'z' | null = null;

  private dragEndSubject = new Subject<void>();
  public onDragEnd$ = this.dragEndSubject.asObservable();

  constructor() {}

  public init(camera: THREE.Camera, canvas: HTMLCanvasElement, controlsManager: ControlsManagerService): void {
    this.camera = camera;
    this.canvas = canvas;
    this.controlsManager = controlsManager;
  }

  // ✅ ¡CORREGIDO! Método para actualizar la cámara que faltaba
  public setCamera(newCamera: THREE.Camera): void {
    this.camera = newCamera;
  }

  public startListening(object: THREE.Object3D, helperManager: InteractionHelperManagerService): void {
    this.selectedObject = object;
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event, helperManager), false);
  }

  public stopListening(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown as any);
    // Asegurarse de que si se deja de escuchar, se quiten los otros listeners también
    this.canvas.removeEventListener('pointermove', this.onPointerMove, false);
    this.canvas.removeEventListener('pointerup', this.onPointerUp, false);
    this.selectedObject = null;
    this.isDragging = false;
  }

  private onPointerDown = (event: PointerEvent, helperManager: InteractionHelperManagerService) => {
    if (event.button !== 0 || !this.selectedObject) return;

    const pointer = new THREE.Vector2();
    pointer.x = (event.clientX / this.canvas.clientWidth) * 2 - 1;
    pointer.y = -(event.clientY / this.canvas.clientHeight) * 2 + 1;
    this.raycaster.setFromCamera(pointer, this.camera);
    
    const pivotPoint = helperManager.getPivotPoint();
    if (!pivotPoint) return;

    const intersects = this.raycaster.intersectObject(pivotPoint);

    if (intersects.length > 0) {
        this.isDragging = true;
        this.controlsManager.disableNavigation();

        // Plano de interacción paralelo a la vista de la cámara
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        this.interactionPlane.setFromNormalAndCoplanarPoint(cameraDirection, this.selectedObject.position);

        if (this.raycaster.ray.intersectPlane(this.interactionPlane, this.intersectionPoint)) {
            this.dragOffset.copy(this.intersectionPoint).sub(this.selectedObject.position);
        }

        this.canvas.addEventListener('pointermove', this.onPointerMove, false);
        this.canvas.addEventListener('pointerup', this.onPointerUp, false);
    }
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.isDragging || !this.selectedObject) return;

    const pointer = new THREE.Vector2();
    pointer.x = (event.clientX / this.canvas.clientWidth) * 2 - 1;
    pointer.y = -(event.clientY / this.canvas.clientHeight) * 2 + 1;
    this.raycaster.setFromCamera(pointer, this.camera);

    if (this.raycaster.ray.intersectPlane(this.interactionPlane, this.intersectionPoint)) {
      const newPosition = this.intersectionPoint.sub(this.dragOffset);
      
      // Aplicar restricciones de eje
      if (this.axisConstraint) {
          if (this.axisConstraint === 'x') newPosition.y = this.selectedObject.position.y; newPosition.z = this.selectedObject.position.z;
          if (this.axisConstraint === 'y') newPosition.x = this.selectedObject.position.x; newPosition.z = this.selectedObject.position.z;
          if (this.axisConstraint === 'z') newPosition.x = this.selectedObject.position.x; newPosition.y = this.selectedObject.position.y;
      }

      this.selectedObject.position.copy(newPosition);
    }
  };

  private onPointerUp = () => {
    if (this.isDragging) {
      this.isDragging = false;
      this.controlsManager.enableNavigation();
      this.dragEndSubject.next();
      this.canvas.removeEventListener('pointermove', this.onPointerMove, false);
      this.canvas.removeEventListener('pointerup', this.onPointerUp, false);
    }
  };

  public setAxisConstraint(axis: 'x' | 'y' | 'z' | null): void {
      this.axisConstraint = axis;
  }
}