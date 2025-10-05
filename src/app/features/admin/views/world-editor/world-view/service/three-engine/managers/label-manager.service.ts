// src/app/features/admin/views/world-editor/world-view/service/three-engine/managers/label-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { CelestialInstanceData } from './object-manager.service';
import { DEEP_SPACE_SCALE_BOOST } from '../core/engine.service';

// ====================================================================
// --- ✨ CONSTANTES AJUSTADAS PARA 3 CATEGORÍAS DE OBJETOS ---
// ====================================================================

const LABEL_FONT_SIZE = 64;
const LABEL_FONT_FAMILY = 'Arial, sans-serif';
const LABEL_TEXT_COLOR = 'rgba(255, 255, 255, 1)';
const LABEL_PADDING = 12;

// --- 1. Para OBJETOS CON MODELO 3D (GLTF: Naves, estaciones, etc.) ---
// Una escala grande relativa al tamaño del modelo para que sea legible.
const MODEL_LABEL_SCALE_FACTOR = 100.0;
// Un desplazamiento Y sutil para que la etiqueta flote justo encima del modelo.
const MODEL_LABEL_Y_OFFSET_MULTIPLIER = 1.2;

// --- 2. Para CUERPOS CELESTIALES GRANDES (Planetas WMTS, esferas primitivas) ---
// Un factor de escala pequeño, ya que el radio base del objeto ya es enorme.
const LARGE_BODY_LABEL_SCALE_FACTOR = 0.8;
// Un desplazamiento Y justo por encima de la "superficie" del planeta.
const LARGE_BODY_LABEL_Y_OFFSET_MULTIPLIER = 1.1;

// --- 3. Para OBJETOS PEQUEÑOS/LEJANOS (Instanciados: estrellas, galaxias) ---
// Una escala base más grande para que sean visibles a distancia.
const DEFAULT_LABEL_SCALE_FACTOR = 8.5;
// Un desplazamiento Y mayor para que la etiqueta salga del "glow" del objeto.
const DEFAULT_LABEL_Y_OFFSET_MULTIPLIER = 8.0;


/**
 * @interface ManagedLabel
 * @description Almacena la información de una etiqueta y su tipo.
 */
interface ManagedLabel {
  uuid: string;
  name: string;
  targetObject?: THREE.Object3D;
  targetPosition: THREE.Vector3;
  targetRadius: number;
  sprite: THREE.Sprite | null;
  // Banderas para diferenciar los tipos de objetos
  isNormalizedModel: boolean;
  isLargeCelestialBody: boolean;
}

@Injectable({ providedIn: 'root' })
export class LabelManagerService {
  private scene!: THREE.Scene;
  private registeredLabels = new Map<string, ManagedLabel>();
  private activeLabels = new Map<string, ManagedLabel>();
  private labelPool: THREE.Sprite[] = [];
  private tempBox = new THREE.Box3();
  private tempVec3 = new THREE.Vector3();

  public init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * ✨ LÓGICA MEJORADA: Registra un objeto y determina a qué categoría pertenece.
   */
  public registerObject(object: THREE.Object3D): void {
    if (!object.name || this.registeredLabels.has(object.uuid)) return;

    this.tempBox.setFromObject(object, true);
    const radius = this.tempBox.getSize(this.tempVec3).y / 2;

    // Determinamos la categoría del objeto usando las banderas de userData.
    const isNormalizedModel = object.userData['isDynamicCelestialModel'] === true || object.type === 'Group';
    const isLargeCelestialBody = object.userData['isWmtsCelestialBody'] === true;

    this.registeredLabels.set(object.uuid, {
      uuid: object.uuid,
      name: object.name,
      targetObject: object,
      targetPosition: object.position.clone(),
      targetRadius: Math.max(radius, 0.1),
      sprite: null,
      isNormalizedModel: isNormalizedModel,
      isLargeCelestialBody: isLargeCelestialBody,
    });
  }

  /**
   * Registra un objeto instanciado. Estos siempre caen en la categoría "default".
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
      isNormalizedModel: false,
      isLargeCelestialBody: false, // Los objetos instanciados no son cuerpos grandes.
    });
  }

  public showLabel(uuid: string): void {
    if (this.activeLabels.has(uuid)) return;
    const labelData = this.registeredLabels.get(uuid);
    if (labelData) {
      this._activateLabel(labelData);
    }
  }

  public hideLabel(uuid: string): void {
    const labelData = this.activeLabels.get(uuid);
    if (labelData) {
      this._deactivateLabel(labelData);
    }
  }

  public hideAllLabels(): void {
    const allActiveLabels = [...this.activeLabels.values()];
    allActiveLabels.forEach(label => this._deactivateLabel(label));
  }

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
   * ✨ LÓGICA MEJORADA: Actualiza la posición de la etiqueta según su categoría.
   */
  public update(): void {
    this.activeLabels.forEach((labelData) => {
      if (!labelData.sprite) return;

      let targetPosition: THREE.Vector3;
      if (labelData.targetObject) {
        targetPosition = labelData.targetObject.getWorldPosition(this.tempVec3);
      } else {
        targetPosition = labelData.targetPosition;
      }
      
      // 1. Seleccionar el multiplicador de altura correcto para la categoría.
      let yOffsetMultiplier: number;
      if (labelData.isNormalizedModel) {
        yOffsetMultiplier = MODEL_LABEL_Y_OFFSET_MULTIPLIER;
      } else if (labelData.isLargeCelestialBody) {
        yOffsetMultiplier = LARGE_BODY_LABEL_Y_OFFSET_MULTIPLIER;
      } else {
        yOffsetMultiplier = DEFAULT_LABEL_Y_OFFSET_MULTIPLIER;
      }

      // 2. Calcular el radio visual, aplicando el "boost" SÓLO a los objetos pequeños.
      const visualRadius = (labelData.isNormalizedModel || labelData.isLargeCelestialBody)
          ? labelData.targetRadius 
          : labelData.targetRadius * DEEP_SPACE_SCALE_BOOST;

      const yOffset = visualRadius * yOffsetMultiplier;
      labelData.sprite.position.copy(targetPosition).add(new THREE.Vector3(0, yOffset, 0));
    });
  }

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
    this.update();
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

  /**
   * ✨ LÓGICA MEJORADA: Actualiza la textura y escala de la etiqueta según su categoría.
   */
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

    // 1. Seleccionar el factor de escala correcto para la categoría.
    let scaleFactor: number;
    if (labelData.isNormalizedModel) {
      scaleFactor = MODEL_LABEL_SCALE_FACTOR;
    } else if (labelData.isLargeCelestialBody) {
      scaleFactor = LARGE_BODY_LABEL_SCALE_FACTOR;
    } else {
      scaleFactor = DEFAULT_LABEL_SCALE_FACTOR;
    }

    const aspect = canvas.width / canvas.height;
    
    // 2. Calcular el radio visual, aplicando el "boost" SÓLO a los objetos pequeños.
    const visualRadius = (labelData.isNormalizedModel || labelData.isLargeCelestialBody)
        ? labelData.targetRadius
        : labelData.targetRadius * DEEP_SPACE_SCALE_BOOST;

    const baseScale = visualRadius * scaleFactor;
    sprite.scale.set(baseScale * aspect, baseScale, 1.0);
  }
}
