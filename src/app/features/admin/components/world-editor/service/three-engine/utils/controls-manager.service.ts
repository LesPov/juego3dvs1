// src/app/features/admin/components/world-editor/service/three-engine/utils/controls-manager.service.ts

import { Injectable, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Subject } from 'rxjs';
import { ToolMode } from '../../../toolbar/toolbar.component';

@Injectable({
  providedIn: 'root'
})
export class ControlsManagerService implements OnDestroy {
  private orbitControls!: OrbitControls;
  private transformControls!: TransformControls & THREE.Object3D;
  private camera!: THREE.PerspectiveCamera;
  private domElement!: HTMLElement;
  private focusPivot!: THREE.Object3D;

  private isOrbitEnabled: boolean = false;
  private isFlyEnabled: boolean = false;
  private isTouchDevice: boolean = false;
  
  private currentToolMode: ToolMode = 'select';
  
  private transformEndSubject = new Subject<void>();
  public onTransformEnd$ = this.transformEndSubject.asObservable();
  
  private velocity = new THREE.Vector3();
  private readonly MOVEMENT_SPEED = 8.0;
  private readonly DAMPING_FACTOR = 0.88;
  private readonly DOLLY_SPEED = 0.2;

  constructor() { }

  public init(camera: THREE.PerspectiveCamera, domElement: HTMLElement, scene: THREE.Scene, focusPivot: THREE.Object3D): void {
    this.camera = camera;
    this.domElement = domElement;
    this.focusPivot = focusPivot;
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.createOrbitControls(camera, domElement);
    this.createTransformControls(camera, domElement, scene);
    this.addEventListeners();
    this.orbitControls.target.copy(this.focusPivot.position);
    this.orbitControls.update();
  }

  private createOrbitControls(camera: THREE.Camera, domElement: HTMLElement): void {
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;
    
    if (this.isTouchDevice) {
      console.log("[ControlsManager] Dispositivo táctil detectado. Habilitando controles táctiles.");
      this.orbitControls.enableZoom = true; // Habilita el "dolly" con el gesto de pellizco
      this.orbitControls.zoomSpeed = 0.7;
      // En touch, un dedo rota, dos dedos hacen pan y pellizco.
      this.orbitControls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      };
    } else {
      console.log("[ControlsManager] Dispositivo de escritorio detectado.");
      this.orbitControls.enableZoom = false; // El zoom se maneja con la rueda del ratón (dolly)
      this.orbitControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    }
  }

  private createTransformControls(camera: THREE.PerspectiveCamera, domElement: HTMLElement, scene: THREE.Scene): void {
    this.transformControls = new TransformControls(camera, domElement) as TransformControls & THREE.Object3D;
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
      if (!this.isTouchDevice) {
        this.isFlyEnabled = !event.value;
      }
    });
    this.transformControls.addEventListener('mouseUp', () => this.transformEndSubject.next());
    this.transformControls.visible = false;
    this.transformControls.enabled = false;
    scene.add(this.transformControls);
  }
  
  public enableNavigation(): void { 
    this.isOrbitEnabled = true; 
    if (!this.isTouchDevice) {
      this.isFlyEnabled = true;
    }
    this.orbitControls.enabled = true; 
  }

  public disableNavigation(): void { 
    this.isOrbitEnabled = false; 
    this.isFlyEnabled = false; 
    this.orbitControls.enabled = false; 
    this.velocity.set(0, 0, 0); 
  }

  public update = (delta: number, keyMap: Map<string, boolean>): boolean => { 
    let moved = false; 
    if (this.isFlyEnabled) { 
      moved = this.handleKeyboardFly(delta, keyMap); 
    } 
    if (this.isOrbitEnabled) { 
      this.orbitControls.update(); 
    } 
    return moved; 
  };
  
  private handleKeyboardFly = (delta: number, keyMap: Map<string, boolean>): boolean => {
    const moveDirection = new THREE.Vector3(); const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); const right = new THREE.Vector3().copy(fwd).cross(this.camera.up).normalize(); if (keyMap.get('w')) moveDirection.add(fwd); if (keyMap.get('s')) moveDirection.sub(fwd); if (keyMap.get('a')) moveDirection.sub(right); if (keyMap.get('d')) moveDirection.add(right); if (keyMap.get('e')) moveDirection.y += 1; if (keyMap.get('q')) moveDirection.y -= 1; const didMove = moveDirection.lengthSq() > 0; if (didMove) { this.velocity.lerp(moveDirection.normalize().multiplyScalar(this.MOVEMENT_SPEED), delta * 5); } this.velocity.multiplyScalar(this.DAMPING_FACTOR); const displacement = this.velocity.clone().multiplyScalar(delta); this.camera.position.add(displacement); this.focusPivot.position.add(displacement); this.orbitControls.target.add(displacement); return didMove;
  };
  
  private addEventListeners = () => { 
    if (!this.isTouchDevice) {
      this.domElement.addEventListener('wheel', this.onDocumentMouseWheel, { passive: false }); 
    }
    this.orbitControls.addEventListener('change', this.syncPivotToControlsTarget); 
  };

  public attach = (object: THREE.Object3D) => { this.transformControls.attach(object); this.setTransformMode(this.currentToolMode); };
  public detach = () => { this.transformControls.detach(); };
  public setTransformMode = (mode: ToolMode) => { this.currentToolMode = mode; const hasObject = !!this.transformControls.object; const isGizmoActive = hasObject && (mode === 'translate' || mode === 'rotate' || mode === 'scale'); this.transformControls.enabled = isGizmoActive; this.transformControls.visible = isGizmoActive; if (isGizmoActive) { this.transformControls.setMode(mode as 'translate' | 'rotate' | 'scale'); } };
  public getCurrentToolMode = (): ToolMode => this.currentToolMode;
  public getControls = (): OrbitControls => this.orbitControls;
  public getGizmoObject = (): THREE.Object3D | undefined => this.transformControls.object;
  
  private syncPivotToControlsTarget = (): void => { if (this.focusPivot) { this.focusPivot.position.copy(this.orbitControls.target); } };
  
  private onDocumentMouseWheel = (event: WheelEvent) => { 
    if (this.isOrbitEnabled) { 
      event.preventDefault(); 
      this.dolly((event.deltaY < 0 ? 1 : -1) * this.DOLLY_SPEED); 
    } 
  };
  
  private dolly = (dollyDelta: number) => { const offset = new THREE.Vector3().copy(this.camera.position).sub(this.orbitControls.target); const dist = Math.max(0.1, offset.length() * (1 - dollyDelta)); offset.setLength(dist); this.camera.position.copy(this.orbitControls.target).add(offset); };
  
  public ngOnDestroy = () => { 
    if (this.domElement && !this.isTouchDevice) { 
      this.domElement.removeEventListener('wheel', this.onDocumentMouseWheel); 
    } 
    if (this.orbitControls) { 
      this.orbitControls.removeEventListener('change', this.syncPivotToControlsTarget); 
      this.orbitControls.dispose(); 
    } 
    if(this.transformControls) { 
      this.transformControls.dispose(); 
    } 
  };
}