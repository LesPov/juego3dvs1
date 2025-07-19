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
  private interactionTargets: THREE.Object3D[] = []; // Ahora puede haber múltiples objetivos

  private raycaster = new THREE.Raycaster();
  private dragPlane = new THREE.Plane();
  private intersectionPoint = new THREE.Vector3();
  private dragOffset = new THREE.Vector3();

  private onDragEndSubject = new Subject<void>();
  public onDragEnd$ = this.onDragEndSubject.asObservable();

  constructor() { }

  public init(camera: THREE.PerspectiveCamera, domElement: HTMLElement, controlsManager: ControlsManagerService): void {
    this.camera = camera;
    this.domElement = domElement;
    this.controlsManager = controlsManager;
    // 🎯 LÓGICA MEJORADA: El raycaster ahora ve la capa 0 (invisible) y la 1 (helpers visibles).
    this.raycaster.layers.enableAll();
  }

  /**
   * Comienza a escuchar eventos de arrastre para un objeto y sus posibles helpers.
   */
  public startListening(objectToMove: THREE.Object3D, helperManager: InteractionHelperManagerService): void {
    this.objectToMove = objectToMove;
    this.interactionTargets = [];

    const interactionSphere = helperManager.getInteractionSphere();
    const pivotPoint = helperManager.getPivotPoint();
    
    // Añadimos los objetivos de interacción si existen.
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
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 1 || !this.objectToMove || this.interactionTargets.length === 0) return;

    const pointer = new THREE.Vector2((event.clientX / this.domElement.clientWidth) * 2 - 1, -(event.clientY / this.domElement.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    
    // 🎯 LÓGICA MEJORADA: Intersecta con todos los objetivos posibles.
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
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isDragging || !this.objectToMove) return;
    event.preventDefault();
    event.stopPropagation();
    
    const pointer = new THREE.Vector2((event.clientX / this.domElement.clientWidth) * 2 - 1, -(event.clientY / this.domElement.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectionPoint)) {
      this.objectToMove.position.copy(this.intersectionPoint).add(this.dragOffset);
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