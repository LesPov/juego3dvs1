import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { CelestialInstanceData } from './object-manager.service';

// ====================================================================
// --- CONSTANTES AJUSTADAS PARA MEJOR VISIBILIDAD ---
// ====================================================================

const LABEL_FONT_SIZE = 72;
const LABEL_FONT_FAMILY = 'Arial, sans-serif';
const LABEL_TEXT_COLOR = 'rgba(255, 255, 255, 1)';
const LABEL_PADDING = 10;
const LABEL_SCALE_FACTOR = 18.0;
const LABEL_Y_OFFSET_MULTIPLIER = 80.2; // Multiplicador para la altura de la etiqueta sobre el objeto.

/**
 * @interface ManagedLabel
 * @description Almacena la información de una etiqueta gestionada por el servicio.
 */
interface ManagedLabel {
  uuid: string;
  name: string;
  targetObject?: THREE.Object3D;
  targetPosition: THREE.Vector3;
  targetRadius: number;
  sprite: THREE.Sprite | null;
}

/**
 * @class LabelManagerService
 * @description
 * Gestiona la creación y visibilidad de las etiquetas de texto (THREE.Sprite) que se
 * muestran sobre los objetos preseleccionados y seleccionados en la escena.
 */
@Injectable({ providedIn: 'root' })
export class LabelManagerService {
  private scene!: THREE.Scene;
  private registeredLabels = new Map<string, ManagedLabel>();
  private activeLabels = new Map<string, ManagedLabel>();
  private labelPool: THREE.Sprite[] = [];
  private tempBox = new THREE.Box3();
  private tempVec3 = new THREE.Vector3();

  /**
   * Inicializa el servicio con la escena principal.
   * @param scene - La instancia de la escena de Three.js.
   */
  public init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Registra un objeto estándar para que pueda mostrar su etiqueta.
   * @param object - El objeto 3D a registrar.
   */
  public registerObject(object: THREE.Object3D): void {
    if (!object.name || this.registeredLabels.has(object.uuid)) return;

    this.tempBox.setFromObject(object, true);
    const radius = this.tempBox.getSize(this.tempVec3).length() / 2;

    this.registeredLabels.set(object.uuid, {
      uuid: object.uuid,
      name: object.name,
      targetObject: object,
      targetPosition: object.position.clone(),
      targetRadius: Math.max(radius, 1.0),
      sprite: null,
    });
  }

  /**
   * Registra los datos de una instancia celeste para que pueda mostrar su etiqueta.
   * @param instanceData - Los datos de la instancia celeste.
   */
  public registerInstancedObject(instanceData: CelestialInstanceData): void {
    if (this.registeredLabels.has(instanceData.originalUuid)) return;

    const radius = Math.max(instanceData.scale.x, instanceData.scale.y, instanceData.scale.z);

    this.registeredLabels.set(instanceData.originalUuid, {
      uuid: instanceData.originalUuid,
      name: instanceData.originalName,
      targetPosition: instanceData.position.clone(),
      targetRadius: radius,
      sprite: null,
    });
  }

  /**
   * Muestra la etiqueta para un objeto específico.
   * @param uuid - El UUID del objeto cuya etiqueta se mostrará.
   */
  public showLabel(uuid: string): void {
    if (this.activeLabels.has(uuid)) return; // Ya está activa

    const labelData = this.registeredLabels.get(uuid);
    if (labelData) {
      this._activateLabel(labelData);
    }
  }

  /**
   * Oculta la etiqueta para un objeto específico.
   * @param uuid - El UUID del objeto cuya etiqueta se ocultará.
   */
  public hideLabel(uuid: string): void {
    const labelData = this.activeLabels.get(uuid);
    if (labelData) {
      this._deactivateLabel(labelData);
    }
  }

  /**
   * Oculta todas las etiquetas que estén actualmente visibles.
   */
  public hideAllLabels(): void {
    const allActiveLabels = [...this.activeLabels.values()];
    allActiveLabels.forEach(label => this._deactivateLabel(label));
  }

  /**
   * Actualiza el texto de una etiqueta si el nombre de un objeto cambia.
   * @param uuid - El UUID del objeto.
   * @param newName - El nuevo nombre.
   */
  public updateLabelText(uuid: string, newName: string): void {
    const labelData = this.registeredLabels.get(uuid);
    if (labelData) {
      labelData.name = newName;
      if (labelData.sprite) {
        this._updateSpriteTexture(labelData.sprite, labelData);
      }
    }
  }

  /**
   * El bucle de actualización, llamado desde EngineService.
   * Actualiza la posición de las etiquetas visibles para que sigan a sus objetos.
   */
  public update(): void { // << ✨ CORRECCIÓN: Se elimina el parámetro 'camera'
    this.activeLabels.forEach((labelData) => {
      if (!labelData.sprite) return;

      let targetPosition: THREE.Vector3;
      if (labelData.targetObject) {
        // Para objetos estándar, obtenemos su posición mundial actual.
        targetPosition = labelData.targetObject.getWorldPosition(this.tempVec3);
      } else {
        // Para objetos instanciados, la posición es fija.
        targetPosition = labelData.targetPosition;
      }

      const yOffset = labelData.targetRadius * LABEL_Y_OFFSET_MULTIPLIER;
      labelData.sprite.position.copy(targetPosition).add(new THREE.Vector3(0, yOffset, 0));
    });
  }

  /** Limpia todas las etiquetas y registros. */
  public clear(): void {
    this.hideAllLabels();
    this.labelPool.forEach(sprite => {
        sprite.material.map?.dispose();
        sprite.material.dispose();
    });
    this.labelPool = [];
    this.registeredLabels.clear();
    this.activeLabels.clear();
  }

  private _activateLabel(labelData: ManagedLabel): void {
    let sprite = this.labelPool.pop();
    if (!sprite) {
      sprite = this._createLabelSprite();
    }

    this._updateSpriteTexture(sprite, labelData);
    sprite.visible = true;
    labelData.sprite = sprite;

    this.scene.add(sprite);
    this.activeLabels.set(labelData.uuid, labelData);
    this.update(); // Llama a update una vez para posicionar la etiqueta inmediatamente.
  }

  private _deactivateLabel(labelData: ManagedLabel): void {
    if (labelData.sprite) {
      labelData.sprite.visible = false;
      this.scene.remove(labelData.sprite);
      this.labelPool.push(labelData.sprite);
    }
    labelData.sprite = null;
    this.activeLabels.delete(labelData.uuid);
  }

  private _createLabelSprite(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    return sprite;
  }

  private _updateSpriteTexture(sprite: THREE.Sprite, labelData: ManagedLabel): void {
    sprite.material.map?.dispose();

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const font = `bold ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
    context.font = font;

    const metrics = context.measureText(labelData.name);
    const textWidth = metrics.width;

    canvas.width = textWidth + LABEL_PADDING * 2;
    canvas.height = LABEL_FONT_SIZE + LABEL_PADDING * 2;

    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 10;

    context.fillStyle = LABEL_TEXT_COLOR;
    context.fillText(labelData.name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    sprite.material.map = texture;

    const aspect = canvas.width / canvas.height;
    const baseScale = labelData.targetRadius * LABEL_SCALE_FACTOR;
    sprite.scale.set(baseScale * aspect, baseScale, 1.0);
  }
}