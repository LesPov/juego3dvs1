// src/app/features/admin/views/world-editor/world-view/service/three-engine/utils/camera-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { BehaviorSubject } from 'rxjs';
import { SceneManagerService } from './scene-manager.service';
import { ControlsManagerService } from './controls-manager.service';
import { EntityManagerService } from './entity-manager.service';
import { SelectionManagerService } from './selection-manager.service';
import { InteractionHelperManagerService } from './interaction-helper.manager.service';
import { DragInteractionManagerService } from './drag-interaction.manager.service';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

export type CameraType = 'editor' | 'secondary';
export type CameraMode = 'perspective' | 'orthographic';

@Injectable({ providedIn: 'root' })
export class CameraManagerService {

  // ====================================================================
  // SECTION: Public Observables & State
  // ====================================================================

  public cameraMode$ = new BehaviorSubject<CameraMode>('perspective');
  public activeCameraType: CameraType = 'editor';
  
  // ====================================================================
  // SECTION: Private State
  // ====================================================================

  private lastPerspectiveState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastOrthographicState: { position: THREE.Vector3, target: THREE.Vector3 } | null = null;
  private lastEditorTarget = new THREE.Vector3();
  private originalProjectionMatrix = new THREE.Matrix4();
  
  // Propiedades temporales para optimización
  private tempBoxSize = new THREE.Vector3();
  private tempWorldPos = new THREE.Vector3();
  private tempQuaternion = new THREE.Quaternion();

  constructor(
    private sceneManager: SceneManagerService,
    private controlsManager: ControlsManagerService,
    private entityManager: EntityManagerService,
    private selectionManager: SelectionManagerService,
    private interactionHelperManager: InteractionHelperManagerService,
    private dragInteractionManager: DragInteractionManagerService,
  ) { }
  
  /**
   * Guarda la matriz de proyección original de la cámara al iniciar.
   */
  public initialize(): void {
    if (this.sceneManager.activeCamera) {
      this.originalProjectionMatrix.copy(this.sceneManager.activeCamera.projectionMatrix);
    }
  }

  // ====================================================================
  // SECTION: Active Camera Switching
  // ====================================================================

  /**
   * Cambia entre la cámara principal del editor y la cámara secundaria.
   */
  public toggleActiveCamera(currentSelectedObject?: THREE.Object3D): void {
    const editorHelper = this.sceneManager.editorCamera.userData['helper'];
    const secondaryHelper = this.sceneManager.secondaryCamera.userData['helper'];
    const controls = this.controlsManager.getControls();

    if (this.activeCameraType === 'editor') {
      // Cambiando a la cámara SECUNDARIA
      this.activeCameraType = 'secondary';
      this.sceneManager.activeCamera = this.sceneManager.secondaryCamera;
      this.lastEditorTarget.copy(controls.target);

      // Posiciona la cámara secundaria "sobre el hombro" de la principal
      const { editorCamera, secondaryCamera } = this.sceneManager;
      const offset = secondaryCamera.userData['initialOffset'] as THREE.Vector3;
      editorCamera.getWorldPosition(this.tempWorldPos);
      editorCamera.getWorldQuaternion(this.tempQuaternion);
      const newCamPos = offset.clone().applyQuaternion(this.tempQuaternion).add(this.tempWorldPos);
      secondaryCamera.position.copy(newCamPos);
      controls.target.copy(this.tempWorldPos);
      
      if (editorHelper) editorHelper.visible = true;
      if (secondaryHelper) secondaryHelper.visible = false;
      this.controlsManager.configureForSecondaryCamera();

    } else {
      // Cambiando de vuelta a la cámara del EDITOR
      this.activeCameraType = 'editor';
      this.sceneManager.activeCamera = this.sceneManager.editorCamera;
      controls.target.copy(this.lastEditorTarget);

      if (editorHelper) editorHelper.visible = false;
      if (secondaryHelper) secondaryHelper.visible = true;
      this.controlsManager.configureForEditorCamera();
    }

    // Actualiza todos los servicios dependientes de la cámara activa
    const newActiveCamera = this.sceneManager.activeCamera;
    this.controlsManager.setCamera(newActiveCamera);
    (this.sceneManager.composer.passes[0] as RenderPass).camera = newActiveCamera;
    this.interactionHelperManager.setCamera(newActiveCamera);
    this.dragInteractionManager.setCamera(newActiveCamera);
    controls.update(); 
    
    // Si el objeto seleccionado es una cámara, adjunta el gizmo a ella.
    if(currentSelectedObject && currentSelectedObject.uuid === newActiveCamera.uuid) {
        this.controlsManager.attach(currentSelectedObject);
    }
  }

  // ====================================================================
  // SECTION: Projection Mode Switching (Perspective / Orthographic)
  // ====================================================================

  /**
   * Alterna entre el modo de cámara 3D (perspectiva) y 2D (ortográfica).
   */
  public toggleCameraMode(): void {
    if (this.cameraMode$.getValue() === 'perspective') {
      const controls = this.controlsManager.getControls();
      this.lastPerspectiveState = {
        position: this.sceneManager.activeCamera.position.clone(),
        target: controls.target.clone()
      };
      this.setCameraView('axis-z'); // Vista frontal por defecto
    } else {
      this.switchToPerspectiveView();
    }
  }

  /**
   * Cambia la cámara a una vista ortográfica específica (frontal, superior, etc.).
   * @param axisName El eje de la vista ('axis-x', 'axis-y-neg', etc.).
   * @param state Un estado opcional para restaurar una vista previa.
   */
  public setCameraView(axisName: string | null, state?: { position: THREE.Vector3, target: THREE.Vector3 }): number {
    const controls = this.controlsManager.getControls();
    const camera = this.sceneManager.activeCamera;
    if (!controls) return 0;
    
    // Guarda el estado de la cámara de perspectiva si estamos cambiando desde ella
    if (this.cameraMode$.getValue() === 'perspective') {
      this.lastPerspectiveState = { position: camera.position.clone(), target: controls.target.clone() };
    }
    
    // Calcula los límites de la escena para enfocarla correctamente
    const boundingBox = this.sceneManager.getSceneBoundingBox();
    if (boundingBox.isEmpty()) return 0;
    const target = boundingBox.getCenter(new THREE.Vector3());
    const boxSize = boundingBox.getSize(this.tempBoxSize);
    const distance = boxSize.length() || 100;
    
    // Posiciona la cámara según el eje seleccionado
    if (axisName) {
      const newPosition = new THREE.Vector3();
      switch (axisName) {
        case 'axis-x': newPosition.set(distance, 0, 0); break;
        case 'axis-x-neg': newPosition.set(-distance, 0, 0); break;
        case 'axis-y': newPosition.set(0, distance, 0.0001); break;
        case 'axis-y-neg': newPosition.set(0, -distance, 0.0001); break;
        case 'axis-z': newPosition.set(0, 0, distance); break;
        case 'axis-z-neg': newPosition.set(0, 0, -distance); break;
        default: return 0;
      }
      camera.position.copy(target).add(newPosition);
    } else if (state) {
      camera.position.copy(state.position);
    }
    
    camera.lookAt(target);
    this.lastOrthographicState = { position: camera.position.clone(), target: target.clone() };

    // Calcula el frustum ortográfico para que toda la escena quepa en la vista
    const rendererDomElement = this.sceneManager.renderer.domElement;
    const aspect = rendererDomElement.clientWidth / rendererDomElement.clientHeight;
    let frustumWidth = Math.max(boxSize.x, 0.1), frustumHeight = Math.max(boxSize.y, 0.1);
    const currentAxis = axisName || this.getAxisFromState(this.lastOrthographicState);
    switch (currentAxis) {
        case 'axis-x': case 'axis-x-neg': frustumHeight = boxSize.y; frustumWidth = boxSize.z; break;
        case 'axis-y': case 'axis-y-neg': frustumHeight = boxSize.z; frustumWidth = boxSize.x; break;
        case 'axis-z': case 'axis-z-neg': default: frustumHeight = boxSize.y; frustumWidth = boxSize.x; break;
    }
    frustumWidth *= 1.1;
    frustumHeight *= 1.1;
    if (frustumWidth / aspect > frustumHeight) { frustumHeight = frustumWidth / aspect; } else { frustumWidth = frustumHeight * aspect; }

    const sceneDepth = Math.max(boxSize.x, boxSize.y, boxSize.z);
    const cameraToCenterDist = camera.position.distanceTo(target);
    const orthoMatrix = new THREE.Matrix4().makeOrthographic(
      frustumWidth / -2, frustumWidth / 2,
      frustumHeight / 2, frustumHeight / -2,
      0.1, cameraToCenterDist + sceneDepth * 2
    );
    
    camera.projectionMatrix.copy(orthoMatrix);
    camera.projectionMatrixInverse.copy(orthoMatrix).invert();

    // Configura los controles para el modo ortográfico (sin rotación)
    this.controlsManager.exitFlyMode();
    this.controlsManager.isFlyEnabled = false;
    controls.enabled = true;
    controls.enableRotate = false;
    controls.target.copy(target);
    controls.update();
    this.selectionManager.updateOutlineParameters('orthographic');
    this.cameraMode$.next('orthographic');
    
    // Devuelve el factor de zoom base para cálculos de visibilidad
    return camera.projectionMatrix.elements[0];
  }

  /**
   * Restaura la vista de la cámara al modo perspectiva 3D.
   */
  public switchToPerspectiveView(): void {
    this.entityManager.resetAllGroupsBrightness();
    const camera = this.sceneManager.activeCamera;
    const controls = this.controlsManager.getControls();
    if (!controls) return;

    // Restaura la última posición y target conocidos en modo perspectiva
    if (this.lastPerspectiveState) {
      camera.position.copy(this.lastPerspectiveState.position);
      controls.target.copy(this.lastPerspectiveState.target);
    } else if (this.lastOrthographicState) {
      // Si no hay estado previo, calcula una posición segura basada en la última vista ortográfica
      const target = this.lastOrthographicState.target.clone();
      const direction = new THREE.Vector3().copy(this.lastOrthographicState.position).sub(target).normalize();
      const boundingBox = this.sceneManager.getSceneBoundingBox();
      const sceneSize = boundingBox.getSize(new THREE.Vector3()).length();
      const safeDistance = sceneSize > 0 ? sceneSize * 1.5 : 500000;
      camera.position.copy(target).addScaledVector(direction, safeDistance);
      controls.target.copy(target);
    }
    
    // Restaura la matriz de proyección original
    camera.near = 0.1;
    camera.far = 500000000000;
    camera.projectionMatrix.copy(this.originalProjectionMatrix);
    camera.projectionMatrixInverse.copy(this.originalProjectionMatrix).invert();

    // Reconfigura los controles para el modo perspectiva (con rotación y vuelo)
    this.controlsManager.isFlyEnabled = true;
    controls.enableRotate = true;
    controls.update();
    this.selectionManager.updateOutlineParameters('perspective');
    this.cameraMode$.next('perspective');
  }

  // ====================================================================
  // SECTION: Utility Methods
  // ====================================================================

  /**
   * Determina el eje principal de la vista a partir de la dirección de la cámara.
   * @param state El estado de la cámara (posición y target).
   * @returns Un string que representa el eje de la vista.
   */
  private getAxisFromState(state: { position: THREE.Vector3, target: THREE.Vector3 } | null): string {
    if (!state) return 'axis-y-neg'; // Vista superior por defecto
    const dir = new THREE.Vector3().copy(state.position).sub(state.target).normalize();
    if (Math.abs(dir.x) > 0.9) return dir.x > 0 ? 'axis-x' : 'axis-x-neg';
    if (Math.abs(dir.y) > 0.9) return dir.y > 0 ? 'axis-y' : 'axis-y-neg';
    return dir.z > 0 ? 'axis-z' : 'axis-z-neg';
  }
}