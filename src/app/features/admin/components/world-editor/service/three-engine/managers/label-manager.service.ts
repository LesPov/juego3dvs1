// src/app/features/admin/views/world-editor/world-view/service/three-engine/managers/label-manager.service.ts

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

// ✨ LÓGICA FINAL: Factores de escala y altura ajustados para una proporción perfecta

// --- Para OBJETOS CON MODELO 3D ---
// Se reduce drásticamente para que la etiqueta sea pequeña y proporcional al modelo.
const MODEL_LABEL_SCALE_FACTOR = 110.5;
// Se ajusta para que la etiqueta se posicione justo encima del borde del objeto.
const MODEL_LABEL_Y_OFFSET_MULTIPLIER = 1.1;

// --- Para OBJETOS POR DEFECTO (Billboards, galaxias, etc.) ---
// ✨ LÓGICA CORREGIDA: Se aumentan drásticamente estos valores para compensar el
// `DEEP_SPACE_SCALE_BOOST` que agranda visualmente los objetos celestiales.
// Esto hará que las etiquetas sean más grandes y se posicionen mucho más arriba.
const DEFAULT_LABEL_SCALE_FACTOR = 0.5;
const DEFAULT_LABEL_Y_OFFSET_MULTIPLIER = 2.0;


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
  isNormalizedModel: boolean; // Guardaremos aquí si el objeto es un modelo para accederlo fácilmente.
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

  public init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  public registerObject(object: THREE.Object3D): void {
    if (!object.name || this.registeredLabels.has(object.uuid)) return;

    this.tempBox.setFromObject(object, true);
    // Usamos la mitad de la altura de la caja contenedora como un "radio" más predecible.
    const radius = this.tempBox.getSize(this.tempVec3).y / 2;

    // Determinamos si es un modelo al registrarlo
    const isNormalizedModel = object.userData['isNormalizedModel'] === true;

    this.registeredLabels.set(object.uuid, {
      uuid: object.uuid,
      name: object.name,
      targetObject: object,
      targetPosition: object.position.clone(),
      targetRadius: Math.max(radius, 1.0),
      sprite: null,
      isNormalizedModel: isNormalizedModel, // Guardamos el estado
    });
  }

  public registerInstancedObject(instanceData: CelestialInstanceData): void {
    if (this.registeredLabels.has(instanceData.originalUuid)) return;

    const radius = Math.max(instanceData.scale.x, instanceData.scale.y, instanceData.scale.z);

    this.registeredLabels.set(instanceData.originalUuid, {
      uuid: instanceData.originalUuid,
      name: instanceData.originalName,
      targetPosition: instanceData.position.clone(),
      targetRadius: radius,
      sprite: null,
      isNormalizedModel: false, // Los objetos instanciados no son modelos 3D en este contexto.
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

  public update(): void {
    this.activeLabels.forEach((labelData) => {
      if (!labelData.sprite) return;

      let targetPosition: THREE.Vector3;
      if (labelData.targetObject) {
        targetPosition = labelData.targetObject.getWorldPosition(this.tempVec3);
      } else {
        targetPosition = labelData.targetPosition;
      }

      // Decidimos qué multiplicador de altura usar basándonos en el tipo de objeto.
      const yOffsetMultiplier = labelData.isNormalizedModel
          ? MODEL_LABEL_Y_OFFSET_MULTIPLIER
          : DEFAULT_LABEL_Y_OFFSET_MULTIPLIER;

      // ✨ LÓGICA: Ahora con el multiplicador corregido, el yOffset será mucho mayor
      // para los objetos celestiales, posicionando la etiqueta correctamente por encima de ellos.
      const yOffset = labelData.targetRadius * yOffsetMultiplier;
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

    // Decidimos qué factor de escala usar basándonos en el tipo de objeto.
    const scaleFactor = labelData.isNormalizedModel
        ? MODEL_LABEL_SCALE_FACTOR
        : DEFAULT_LABEL_SCALE_FACTOR;

    const aspect = canvas.width / canvas.height;
    // ✨ LÓGICA: El `baseScale` ahora será mucho mayor para objetos celestiales,
    // haciendo la etiqueta más grande y legible a distancia.
    const baseScale = labelData.targetRadius * scaleFactor;
    sprite.scale.set(baseScale * aspect, baseScale, 1.0);
  }
}