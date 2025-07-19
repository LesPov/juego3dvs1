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
  // --- Propiedades ---
  private clock = new THREE.Clock();
  private animationFrameId?: number;
  private keyMap = new Map<string, boolean>();
  private cameraOrientation = new BehaviorSubject<THREE.Quaternion>(new THREE.Quaternion());
  private tempQuaternion = new THREE.Quaternion();
  private needsRender = true;
  private selectedObject?: THREE.Object3D;
  private onTransformEndSubject = new Subject<void>();
  public onTransformEnd$ = this.onTransformEndSubject.asObservable();
  
  private isDraggingPivot = false;
  private raycaster = new THREE.Raycaster();
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private intersectionPoint = new THREE.Vector3();

  private originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();
  private centerPivotHelper?: THREE.Group;
  private pivotSphere?: THREE.Mesh;
  private axesHelper?: THREE.AxesHelper;
  private controlsSubscription?: Subscription;
  
  private readonly HELPER_SCREEN_SCALE_FACTOR = 0.1;

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
      console.log("[EngineService] Dispositivo táctil detectado. Optimizando pixel ratio para rendimiento.");
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

  // ✅ LÓGICA DE HERRAMIENTAS CORREGIDA Y SIMPLIFICADA
  public setToolMode(mode: ToolMode): void {
    // 1. SIEMPRE actualizamos la herramienta en el manager. Esta es ahora la fuente de verdad.
    this.controlsManager.setTransformMode(mode);

    // 2. Limpiamos cualquier estado anterior
    this.cleanupInteractiveHelper();
    this.controlsManager.detach();

    // 3. Si hay un objeto seleccionado, APLICAMOS la nueva herramienta
    if (this.selectedObject) {
      switch (mode) {
        case 'move':
          this.createInteractiveHelper(this.selectedObject);
          break;
        case 'rotate':
        case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
        // En caso de 'select', no hacemos nada más que limpiar, lo cual ya se hizo.
      }
    }
    
    this.requestRender();
  }

  // ✅ LÓGICA DE SELECCIÓN CORREGIDA Y SIMPLIFICADA
  public selectObjectByUuid(uuid: string | null): void {
    // 1. Limpiamos helpers del objeto anterior
    this.cleanupInteractiveHelper();
    this.controlsManager.detach();

    // 2. Actualizamos el objeto seleccionado
    this.selectedObject = uuid ? this.entityManager.getObjectByUuid(uuid) : undefined;
    this.entityManager.selectObjectByUuid(uuid, this.sceneManager.focusPivot);
    
    // 3. Obtenemos la herramienta que YA ESTÁ ACTIVA en el manager
    const currentTool = this.controlsManager.getCurrentToolMode();
    
    // 4. Si hay un nuevo objeto seleccionado, APLICAMOS la herramienta activa
    if (this.selectedObject) {
      switch (currentTool) {
        case 'move':
          this.createInteractiveHelper(this.selectedObject);
          break;
        case 'rotate':
        case 'scale':
          this.controlsManager.attach(this.selectedObject);
          break;
      }
    }

    this.requestRender();
  }

  private createInteractiveHelper(object: THREE.Object3D): void {
    if (this.centerPivotHelper) this.cleanupInteractiveHelper();
    const box = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const baseSize = 1;
    this.centerPivotHelper = new THREE.Group();
    this.centerPivotHelper.position.copy(center);
    this.sceneManager.scene.add(this.centerPivotHelper);
    this.axesHelper = new THREE.AxesHelper(baseSize * 1.5);
    (this.axesHelper.material as THREE.Material).depthTest = false;
    this.centerPivotHelper.add(this.axesHelper);
    const visibleSphereGeo = new THREE.SphereGeometry(baseSize * 0.1, 16, 16);
    const visibleSphereMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false });
    const visibleSphere = new THREE.Mesh(visibleSphereGeo, visibleSphereMat);
    this.centerPivotHelper.add(visibleSphere);
    const hitboxGeo = new THREE.SphereGeometry(baseSize, 8, 8);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false });
    this.pivotSphere = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.centerPivotHelper.add(this.pivotSphere);
    this.updateHelperScale();
    this.sceneManager.renderer.domElement.addEventListener('pointerdown', this.onPivotPointerDown);
    this.sceneManager.renderer.domElement.addEventListener('pointermove', this.onPivotPointerMove);
    this.sceneManager.renderer.domElement.addEventListener('pointerup', this.onPivotPointerUp);
  }

  private cleanupInteractiveHelper(): void {
    if (this.isDraggingPivot) {
      this.onPivotPointerUp();
    }
    this.sceneManager.renderer.domElement.removeEventListener('pointerdown', this.onPivotPointerDown);
    this.sceneManager.renderer.domElement.removeEventListener('pointermove', this.onPivotPointerMove);
    this.sceneManager.renderer.domElement.removeEventListener('pointerup', this.onPivotPointerUp);
    if (this.selectedObject && this.selectedObject.parent !== this.sceneManager.scene) { this.sceneManager.scene.attach(this.selectedObject); }
    if (this.selectedObject) { this.restoreObjectMaterial(this.selectedObject); }
    if (this.centerPivotHelper) {
      this.centerPivotHelper.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } });
      this.sceneManager.scene.remove(this.centerPivotHelper); 
      this.axesHelper?.dispose(); 
      this.centerPivotHelper = undefined; 
      this.axesHelper = undefined; 
      this.pivotSphere = undefined;
    }
    this.controlsManager.enableNavigation(); 
    this.requestRender();
  }

  private onPivotPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const pointer = new THREE.Vector2();
    pointer.x = (event.clientX / this.sceneManager.renderer.domElement.clientWidth) * 2 - 1;
    pointer.y = - (event.clientY / this.sceneManager.renderer.domElement.clientHeight) * 2 + 1;
    this.raycaster.setFromCamera(pointer, this.sceneManager.editorCamera);
    const intersects = this.raycaster.intersectObject(this.pivotSphere!);
    if (intersects.length > 0 && this.selectedObject) {
      this.isDraggingPivot = true;
      this.controlsManager.disableNavigation();
      const cameraDirection = new THREE.Vector3();
      this.sceneManager.editorCamera.getWorldDirection(cameraDirection);
      this.dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, intersects[0].point);
      this.dragOffset.copy(intersects[0].point).sub(this.centerPivotHelper!.position);
      this.makeObjectOpaque(this.selectedObject);
      this.centerPivotHelper!.attach(this.selectedObject);
      this.requestRender();
    }
  }

  private onPivotPointerMove = (event: PointerEvent): void => {
    if (!this.isDraggingPivot) return;
    const pointer = new THREE.Vector2();
    pointer.x = (event.clientX / this.sceneManager.renderer.domElement.clientWidth) * 2 - 1;
    pointer.y = - (event.clientY / this.sceneManager.renderer.domElement.clientHeight) * 2 + 1;
    this.raycaster.setFromCamera(pointer, this.sceneManager.editorCamera);
    this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectionPoint);
    this.centerPivotHelper!.position.copy(this.intersectionPoint).sub(this.dragOffset);
    this.requestRender();
  }

  private onPivotPointerUp = (): void => {
    if (!this.isDraggingPivot) return;
    this.isDraggingPivot = false;
    if (this.selectedObject) {
      this.sceneManager.scene.attach(this.selectedObject);
      this.restoreObjectMaterial(this.selectedObject);
      this.onTransformEndSubject.next();
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

  private makeObjectOpaque(object: THREE.Object3D): void {
    this.originalMaterials.clear();
    object.traverse(child => { if (child instanceof THREE.Mesh) { this.originalMaterials.set(child.uuid, child.material); const newMaterial = (Array.isArray(child.material) ? child.material[0] : child.material).clone() as THREE.MeshStandardMaterial; newMaterial.color.set(0xaaaaaa); newMaterial.transparent = true; newMaterial.opacity = 0.6; newMaterial.depthWrite = false; child.material = newMaterial; } });
  }

  private restoreObjectMaterial(object: THREE.Object3D): void {
    object.traverse(child => { if (child instanceof THREE.Mesh && this.originalMaterials.has(child.uuid)) { child.material = this.originalMaterials.get(child.uuid)!; } });
    this.originalMaterials.clear();
  }

  public getSceneEntities = (): Observable<SceneEntity[]> => this.entityManager.getSceneEntities();
  public getCameraOrientation = (): Observable<THREE.Quaternion> => this.cameraOrientation.asObservable();
  public getGizmoAttachedObject = (): THREE.Object3D | undefined => this.selectedObject;
  public addObjectToScene = (objData: SceneObjectResponse) => { this.entityManager.createObjectFromData(objData); this.entityManager.publishSceneEntities(); this.requestRender(); };
  public updateObjectName = (uuid: string, newName: string) => { this.entityManager.updateObjectName(uuid, newName); this.requestRender(); };
  public updateObjectTransform = (uuid: string, path: 'position' | 'rotation' | 'scale', value: { x: number, y: number, z: number }) => { const obj = this.entityManager.getObjectByUuid(uuid); if (obj) { obj[path].set(value.x, value.y, value.z); this.requestRender(); } };
  public setCameraView = (axisName: string) => { const c = this.controlsManager.getControls(); if (!c) return; const t = this.sceneManager.focusPivot.position; const d = Math.max(this.sceneManager.editorCamera.position.distanceTo(t), 5); const p = new THREE.Vector3(); switch (axisName) { case 'axis-x': p.set(d, 0, 0); break; case 'axis-x-neg': p.set(-d, 0, 0); break; case 'axis-y': p.set(0, d, 0); break; case 'axis-y-neg': p.set(0, -d, 0.0001); break; case 'axis-z': p.set(0, 0, d); break; case 'axis-z-neg': p.set(0, 0, -d); break; default: return; } this.sceneManager.editorCamera.position.copy(t).add(p); this.sceneManager.editorCamera.lookAt(t); c.target.copy(t); c.update(); this.requestRender(); };
  public requestRender = () => { this.needsRender = true; };

  private addEventListeners = () => {
    this.controlsManager.getControls().addEventListener('change', () => {
      this.updateHelperScale();
      this.requestRender();
    });
    window.addEventListener('resize', this.onWindowResize); window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp);
    this.controlsSubscription = this.controlsManager.onTransformEnd$.subscribe(() => { this.onTransformEndSubject.next(); });
  };

  private removeEventListeners = () => {
    this.controlsManager.getControls()?.removeEventListener('change', this.requestRender);
    window.removeEventListener('resize', this.onWindowResize); window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp);
    this.controlsSubscription?.unsubscribe();
  };

  private onWindowResize = () => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) { this.sceneManager.renderer?.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); }
    this.sceneManager.onWindowResize(); this.selectionManager.onResize(this.sceneManager.renderer.domElement.width, this.sceneManager.renderer.domElement.height); 
    this.updateHelperScale();
    this.requestRender();
  };

  private onKeyDown = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), true);
  private onKeyUp = (e: KeyboardEvent) => this.keyMap.set(e.key.toLowerCase(), false);

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

  ngOnDestroy = () => {
    this.removeEventListeners(); 
    this.cleanupInteractiveHelper();
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.statsManager.destroy(); this.controlsManager.ngOnDestroy();
    if (this.sceneManager.renderer) this.sceneManager.renderer.dispose();
  };
}