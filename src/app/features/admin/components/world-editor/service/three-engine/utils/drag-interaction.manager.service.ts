import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { Subject } from 'rxjs';
import { ControlsManagerService } from './controls-manager.service';
import { InteractionHelperManagerService } from './interaction-helper.manager.service';

@Injectable({
  providedIn: 'root'
})
export class DragInteractionManagerService {
  private camera!: THREE.PerspectiveCamera;
  private domElement!: HTMLElement;
  private controlsManager!: ControlsManagerService;

  private isDragging = false;
  private objectToMove?: THREE.Object3D;
  private interactionTargets: THREE.Object3D[] = [];

  private raycaster = new THREE.Raycaster();
  private dragPlane = new THREE.Plane();
  private intersectionPoint = new THREE.Vector3();
  private dragOffset = new THREE.Vector3();

  // 🎯 NUEVA LÓGICA: Almacena el eje restringido y la posición inicial del arrastre.
  private constrainedAxis: 'x' | 'y' | 'z' | null = null;
  private dragStartPosition = new THREE.Vector3();

  private onDragEndSubject = new Subject<void>();
  public onDragEnd$ = this.onDragEndSubject.asObservable();

  constructor() { }

  public init(camera: THREE.PerspectiveCamera, domElement: HTMLElement, controlsManager: ControlsManagerService): void {
    this.camera = camera;
    this.domElement = domElement;
    this.controlsManager = controlsManager;
    this.raycaster.layers.enableAll();
  }

  public startListening(objectToMove: THREE.Object3D, helperManager: InteractionHelperManagerService): void {
    this.objectToMove = objectToMove;
    this.interactionTargets = [];

    const interactionSphere = helperManager.getInteractionSphere();
    const pivotPoint = helperManager.getPivotPoint();
    
    if (interactionSphere) this.interactionTargets.push(interactionSphere);
    if (pivotPoint) this.interactionTargets.push(pivotPoint);

    if (this.interactionTargets.length > 0) {
      this.domElement.addEventListener('pointerdown', this.onPointerDown);
      this.domElement.addEventListener('pointermove', this.onPointerMove);
      this.domElement.addEventListener('pointerup', this.onPointerUp);
    }
  }

  public stopListening(): void {
    if (this.isDragging) this.onPointerUp();
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.interactionTargets = [];
    this.objectToMove = undefined;
    // 🎯 NUEVA LÓGICA: Reiniciamos la restricción al detener la escucha.
    this.constrainedAxis = null;
  }

  // 🎯 NUEVA LÓGICA: Método público para que EngineService establezca la restricción.
  public setAxisConstraint(axis: 'x' | 'y' | 'z' | null): void {
    this.constrainedAxis = axis;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 1 || !this.objectToMove || this.interactionTargets.length === 0) return;

    const pointer = new THREE.Vector2((event.clientX / this.domElement.clientWidth) * 2 - 1, -(event.clientY / this.domElement.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    
    const intersects = this.raycaster.intersectObjects(this.interactionTargets);

    if (intersects.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      this.isDragging = true;
      this.controlsManager.disableNavigation();
      
      const intersectionPoint = intersects[0].point;
      const cameraDirection = new THREE.Vector3();
      this.camera.getWorldDirection(cameraDirection);
      this.dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, intersectionPoint);
      this.dragOffset.copy(this.objectToMove.position).sub(intersectionPoint);

      // 🎯 NUEVA LÓGICA: Guardamos la posición inicial del objeto al comenzar el arrastre.
      // Esto es crucial para restringir el movimiento en los otros dos ejes.
      this.dragStartPosition.copy(this.objectToMove.position);
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isDragging || !this.objectToMove) return;
    event.preventDefault();
    event.stopPropagation();
    
    const pointer = new THREE.Vector2((event.clientX / this.domElement.clientWidth) * 2 - 1, -(event.clientY / this.domElement.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectionPoint)) {
      // Calculamos la nueva posición potencial sin restricciones.
      const potentialNewPos = this.intersectionPoint.clone().add(this.dragOffset);

      // 🎯 LÓGICA MODIFICADA: Aplicamos la restricción del eje si existe.
      if (this.constrainedAxis) {
        switch (this.constrainedAxis) {
          case 'x':
            // Movemos solo en X, manteniendo Y y Z de la posición inicial.
            this.objectToMove.position.set(potentialNewPos.x, this.dragStartPosition.y, this.dragStartPosition.z);
            break;
          case 'y':
            // Movemos solo en Y, manteniendo X y Z de la posición inicial.
            this.objectToMove.position.set(this.dragStartPosition.x, potentialNewPos.y, this.dragStartPosition.z);
            break;
          case 'z':
            // Movemos solo en Z, manteniendo X e Y de la posición inicial.
            this.objectToMove.position.set(this.dragStartPosition.x, this.dragStartPosition.y, potentialNewPos.z);
            break;
        }
      } else {
        // Si no hay restricción, movemos libremente como antes.
        this.objectToMove.position.copy(potentialNewPos);
      }

      this.onDragEndSubject.next();
    }
  }

  private onPointerUp = (): void => {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.controlsManager.enableNavigation();
    this.onDragEndSubject.next();
  }
}