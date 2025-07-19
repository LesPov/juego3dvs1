// src/app/features/admin/components/world-editor/service/three-engine/engine.service.ts

import { Injectable, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';

import { ControlsManagerService } from './utils/controls-manager.service';
import { EntityManagerService, SceneEntity } from './utils/entity-manager.service';
import { SceneManagerService } from './utils/scene-manager.service';
import { SelectionManagerService } from './utils/selection-manager.service';
import { StatsManagerService } from './utils/stats-manager.service';
import { ToolMode } from '../../toolbar/toolbar.component';
import { SceneObjectResponse } from '../../../../services/admin.service';

@Injectable()
export class EngineService implements OnDestroy {

  // =================================================================
  // --- SECCIÓN: Propiedades del Servicio ---
  // =================================================================

  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private keyMap = new Map<string, boolean>();
  private cameraOrientation = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private tempQuaternion = new THREE.Quaternion();
  private needsRender = true;
  private selectedObject?: THREE.Object3D;
  private onTransformEndSubject = new Subject<void>();
  public onTransformEnd$ = this.onTransformEndSubject.asObservable();

  // --- Propiedades para el arrastre de objetos ---
  private isDraggingObject = false;
  private raycaster = new THREE.Raycaster();
  private dragPlane = new THREE.Plane();
  private intersectionPoint = new THREE.Vector3();
  private originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();

  // 🧠 LÓGICA DE PROYECCIÓN 🧠
  // Vector para almacenar el offset en el espacio de la pantalla (2D)
  private screenSpaceOffset = new THREE.Vector2();

  // --- Propiedades del helper visual ---
  private centerPivotHelper?: THREE.Group;
  private axesHelper?: THREE.AxesHelper;
  private controlsSubscription?: Subscription;
  private readonly HELPER_SCREEN_SCALE_FACTOR = 0.1;
  private hitboxVisualizer?: THREE.Mesh;

  // =================================================================
  // --- SECCIÓN: Ciclo de Vida e Inicialización ---
  // =================================================================

  constructor(
    private sceneManager: SceneManagerService,
    private entityManager: EntityManagerService,
    private controlsManager: ControlsManagerService,
    private selectionManager: SelectionManagerService,
    private statsManager: StatsManagerService
  ) { }

  public init(canvasRef: ElementRef<HTMLCanvasElement>, objects: SceneObjectResponse[], onProgress: (p: number) => void, onLoaded: () => void): void {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      this.sceneManager.renderer?.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    }

    this.sceneManager.setupBasicScene(canvasRef.nativeElement);
    this.entityManager.init(this.sceneManager.scene);
    this.statsManager.init();
    const lm = this.entityManager.getLoadingManager();
    lm.onProgress = (_, i, t) => onProgress((i / t) * 100);
    lm.onLoad = () => { onLoaded(); this.entityManager.publishSceneEntities(); this.requestRender(); };
    objects.forEach(o => this.entityManager.createObjectFromData(o));
    if (!objects.some(o => o.type === 'model' && o.asset?.path)) { setTimeout(() => lm.onLoad!(), 0); }
    this.selectionManager.init(this.sceneManager.scene, this.sceneManager.editorCamera, this.sceneManager.renderer, canvasRef.nativeElement);
    this.controlsManager.init(this.sceneManager.editorCamera, canvasRef.nativeElement, this.sceneManager.scene, this.sceneManager.focusPivot);
    this.controlsManager.enableNavigation();
    this.addEventListeners();
    this.animate();
  }

  ngOnDestroy = () => {
    this.removeEventListeners();
    this.cleanupInteractiveHelper();
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.statsManager.destroy(); this.controlsManager.ngOnDestroy();
    if (this.sceneManager.renderer) this.sceneManager.renderer.dispose();
  };

  // =================================================================
  // --- SECCIÓN: Gestión de Herramientas y Selección ---
  // =================================================================

  public setToolMode(mode: ToolMode): void {
    this.controlsManager.setTransformMode(mode);
    this.cleanupInteractiveHelper();
    this.controlsManager.detach();

    if (this.selectedObject) {
      switch (mode) {
        case 'move':
          this.createVisualHelper(this.selectedObject);
          break;
        case 'rotate':
        case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }
    this.requestRender();
  }

  public selectObjectByUuid(uuid: string | null): void {
    this.cleanupInteractiveHelper();
    this.controlsManager.detach();

    this.selectedObject = uuid ? this.entityManager.getObjectByUuid(uuid) : undefined;
    this.entityManager.selectObjectByUuid(uuid, this.sceneManager.focusPivot);

    const currentTool = this.controlsManager.getCurrentToolMode();

    if (this.selectedObject) {
      switch (currentTool) {
        case 'move':
          this.createVisualHelper(this.selectedObject);
          break;
        case 'rotate':
        case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }
    this.requestRender();
  }

  // =================================================================
  // --- SECCIÓN: Lógica del Helper Visual y Arrastre (Herramienta Mover) ---
  // =================================================================

  private createVisualHelper(object: THREE.Object3D): void {
    if (this.centerPivotHelper) this.cleanupInteractiveHelper();

    const box = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const baseSize = 1;

    this.centerPivotHelper = new THREE.Group();
    this.centerPivotHelper.position.copy(center);
    this.sceneManager.scene.add(this.centerPivotHelper);
    
    this.centerPivotHelper.raycast = () => {};

    this.axesHelper = new THREE.AxesHelper(baseSize * 1.5);
    (this.axesHelper.material as THREE.Material).depthTest = false;
    this.centerPivotHelper.add(this.axesHelper);

    const visibleSphereGeo = new THREE.SphereGeometry(baseSize * 0.1, 16, 16);
    const visibleSphereMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest :false });
    const visibleSphere = new THREE.Mesh(visibleSphereGeo, visibleSphereMat);
    this.centerPivotHelper.add(visibleSphere);

    this.updateHelperScale();

    this.sceneManager.renderer.domElement.addEventListener('pointerdown', this.onObjectDragStart);
    this.sceneManager.renderer.domElement.addEventListener('pointermove', this.onObjectDragMove);
    this.sceneManager.renderer.domElement.addEventListener('pointerup', this.onObjectDragEnd);
  }

  private cleanupInteractiveHelper(): void {
    if (this.isDraggingObject) { this.onObjectDragEnd(); }
    
    this.sceneManager.renderer.domElement.removeEventListener('pointerdown', this.onObjectDragStart);
    this.sceneManager.renderer.domElement.removeEventListener('pointermove', this.onObjectDragMove);
    this.sceneManager.renderer.domElement.removeEventListener('pointerup', this.onObjectDragEnd);

    if (this.selectedObject) { this.restoreObjectMaterial(this.selectedObject); }
    
    if (this.hitboxVisualizer) {
        this.hitboxVisualizer.geometry.dispose();
        (this.hitboxVisualizer.material as THREE.Material).dispose();
        this.sceneManager.scene.remove(this.hitboxVisualizer);
        this.hitboxVisualizer = undefined;
    }

    if (this.centerPivotHelper) {
      this.centerPivotHelper.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } });
      this.sceneManager.scene.remove(this.centerPivotHelper);
      this.axesHelper?.dispose();
      this.centerPivotHelper = undefined;
      this.axesHelper = undefined;
    }
    this.controlsManager.enableNavigation();
    this.requestRender();
  }

  private onObjectDragStart = (event: PointerEvent): void => {
    if (event.button !== 1 || !this.selectedObject) return;
    
    const pointer = new THREE.Vector2();
    pointer.x = (event.clientX / this.sceneManager.renderer.domElement.clientWidth) * 2 - 1;
    pointer.y = - (event.clientY / this.sceneManager.renderer.domElement.clientHeight) * 2 + 1;
    this.raycaster.setFromCamera(pointer, this.sceneManager.editorCamera);
    
    const intersects = this.raycaster.intersectObject(this.selectedObject, true);

    if (intersects.length > 0) {
      event.preventDefault();
      event.stopPropagation();

      this.isDraggingObject = true;
      this.controlsManager.disableNavigation();
      
      this.makeObjectOpaque(this.selectedObject);

      // --- 🧠 LÓGICA DE PROYECCIÓN (Inicio) 🧠 ---

      // 1. Crear el plano de arrastre que pasa por el pivote del objeto
      const cameraDirection = new THREE.Vector3();
      this.sceneManager.editorCamera.getWorldDirection(cameraDirection);
      this.dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, this.selectedObject.position);

      // 2. Proyectar la posición 3D del objeto al espacio 2D de la pantalla
      const objectScreenPosition = this.selectedObject.position.clone().project(this.sceneManager.editorCamera);

      // 3. Calcular el offset en el espacio 2D de la pantalla
      this.screenSpaceOffset.copy(pointer).sub(objectScreenPosition);

      // (El visualizador de hitbox sigue siendo útil para depuración)
      const hitMesh = intersects[0].object as THREE.Mesh;
      if (hitMesh && hitMesh.geometry) {
        const debugMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.7, depthTest: false });
        this.hitboxVisualizer = new THREE.Mesh(hitMesh.geometry, debugMaterial);
        const worldPosition = new THREE.Vector3();
        const worldQuaternion = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        hitMesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
        this.hitboxVisualizer.position.copy(worldPosition);
        this.hitboxVisualizer.quaternion.copy(worldQuaternion);
        this.hitboxVisualizer.scale.copy(worldScale);
        this.sceneManager.scene.add(this.hitboxVisualizer);
      }
      
      this.requestRender();
    }
  }

  private onObjectDragMove = (event: PointerEvent): void => {
    if (!this.isDraggingObject) return;
    event.preventDefault();
    event.stopPropagation();

    const pointer = new THREE.Vector2();
    pointer.x = (event.clientX / this.sceneManager.renderer.domElement.clientWidth) * 2 - 1;
    pointer.y = - (event.clientY / this.sceneManager.renderer.domElement.clientHeight) * 2 + 1;

    // --- 🧠 LÓGICA DE PROYECCIÓN (Movimiento) 🧠 ---

    // 1. Calcular la nueva posición del objeto en el espacio de pantalla 2D
    const newObjectScreenPosition = pointer.clone().sub(this.screenSpaceOffset);

    // 2. Crear un nuevo rayo desde la nueva posición de pantalla
    this.raycaster.setFromCamera(newObjectScreenPosition, this.sceneManager.editorCamera);
    
    // 3. Encontrar el punto de intersección de este nuevo rayo con el plano de arrastre original
    this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectionPoint);

    // 4. Mover el objeto a ese punto de intersección 3D
    this.selectedObject!.position.copy(this.intersectionPoint);

    // Actualizar el helper visual para que siga al objeto
    const box = new THREE.Box3().setFromObject(this.selectedObject!);
    const center = new THREE.Vector3();
    box.getCenter(center);
    if (this.centerPivotHelper) {
      this.centerPivotHelper.position.copy(center);
    }
    
    this.requestRender();
  }

  private onObjectDragEnd = (): void => {
    if (!this.isDraggingObject) return;
    this.isDraggingObject = false;

    if (this.selectedObject) {
      this.restoreObjectMaterial(this.selectedObject);
      this.onTransformEndSubject.next();
    }
    
    if (this.hitboxVisualizer) {
        this.hitboxVisualizer.geometry.dispose();
        (this.hitboxVisualizer.material as THREE.Material).dispose();
        this.sceneManager.scene.remove(this.hitboxVisualizer);
        this.hitboxVisualizer = undefined;
    }

    this.controlsManager.enableNavigation();
    this.requestRender();
  }

  private updateHelperScale(): void {
    if (!this.centerPivotHelper) return;
    const camera = this.sceneManager.editorCamera;
    const distance = this.centerPivotHelper.position.distanceTo(camera.position);
    const scale = distance * this.HELPER_SCREEN_SCALE_FACTOR;
    this.centerPivotHelper.scale.set(scale, scale, scale);
    this.requestRender();
  }

  // (El resto del archivo no necesita cambios)
  // ...
  // =================================================================
  // --- SECCIÓN: Manipulación de Materiales ---
  // =================================================================

  private makeObjectOpaque(object: THREE.Object3D): void {
    this.originalMaterials.clear();
    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        this.originalMaterials.set(child.uuid, child.material);
        const newMaterial = (Array.isArray(child.material) ? child.material[0] : child.material).clone() as THREE.MeshStandardMaterial;
        newMaterial.color.set(0xaaaaaa);
        newMaterial.transparent = true;
        newMaterial.opacity = 0.6;
        newMaterial.depthWrite = false;
        child.material = newMaterial;
      }
    });
  }

  private restoreObjectMaterial(object: THREE.Object3D): void {
    object.traverse(child => {
      if (child instanceof THREE.Mesh && this.originalMaterials.has(child.uuid)) {
        child.material = this.originalMaterials.get(child.uuid)!;
      }
    });
    this.originalMaterials.clear();
  }

  // =================================================================
  // --- SECCIÓN: Bucle Principal de Animación (Render Loop) ---
  // =================================================================

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.statsManager.begin();
    const delta = this.clock.getDelta();

    if (this.controlsManager.update(delta, this.keyMap)) {
      this.requestRender();
      this.updateHelperScale();
    }

    this.sceneManager.editorCamera.getWorldQuaternion(this.tempQuaternion);
    if (!this.tempQuaternion.equals(this.cameraOrientation.getValue())) {
      this.cameraOrientation.next(this.tempQuaternion.clone());
    }
    if (this.needsRender) {
      this.selectionManager.composer.render();
      this.needsRender = false;
    }
    this.statsManager.end();
  };

  // =================================================================
  // --- SECCIÓN: Gestión de Eventos del Navegador ---
  // =================================================================

  private addEventListeners = () => {
    this.controlsManager.getControls().addEventListener('change', () => {
      this.updateHelperScale();
      this.requestRender();
    });
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.controlsSubscription = this.controlsManager.onTransformEnd$.subscribe(() => {
      this.onTransformEndSubject.next();
    });
  };

  private removeEventListeners = () => {
    this.controlsManager.getControls()?.removeEventListener('change', this.requestRender);
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controlsSubscription?.unsubscribe();
  };

  private onWindowResize = () => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) { this.sceneManager.renderer?.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); }
    this.sceneManager.onWindowResize();
    this.selectionManager.onResize(this.sceneManager.renderer.domElement.width, this.sceneManager.renderer.domElement.height);
    this.updateHelperScale();
    this.requestRender();
  };

  private onKeyDown = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), true);
  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);

  // =================================================================
  // --- SECCIÓN: API Pública y Métodos de Acceso ---
  // =================================================================

  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getCameraOrientation = (): Observable<THREE.Quaternion> => this.cameraOrientation.asObservable();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public addObjectToScene = (objData: SceneObjectResponse) => { this.entityManager.createObjectFromData(objData); this.entityManager.publishSceneEntities(); this.requestRender(); };
  public updateObjectName = (uuid: string, newName: string) => { this.entityManager.updateObjectName(uuid, newName); this.requestRender(); };

  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number, y: number, z: number }) => {
    const obj = this.entityManager.getObjectByUuid(uuid);
    if (obj) {
      obj[path].set(value.x, value.y, value.z);
      if (path === 'position' && this.centerPivotHelper) {
        const box = new THREE.Box3().setFromObject(obj);
        const center = new THREE.Vector3();
        box.getCenter(center);
        this.centerPivotHelper.position.copy(center);
      }
      this.requestRender();
    }
  };
  
  public setCameraView = (axisName: string) => { const c = this.controlsManager.getControls(); if (!c) return; const t = this.sceneManager.focusPivot.position; const d = Math.max(this.sceneManager.editorCamera.position.distanceTo(t), 5); const p = new THREE.Vector3(); switch (axisName) { case 'axis-x': p.set(d, 0, 0); break; case 'axis-x-neg': p.set(-d, 0, 0); break; case 'axis-y': p.set(0, d, 0); break; case 'axis-y-neg': p.set(0, -d, 0.0001); break; case 'axis-z': p.set(0, 0, d); break; case 'axis-z-neg': p.set(0, 0, -d); break; default: return; } this.sceneManager.editorCamera.position.copy(t).add(p); this.sceneManager.editorCamera.lookAt(t); c.target.copy(t); c.update(); this.requestRender(); };
  public requestRender = () => { this.needsRender = true; };
}