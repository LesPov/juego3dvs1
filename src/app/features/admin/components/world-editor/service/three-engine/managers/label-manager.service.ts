// src/app/features/admin/views/world-editor/world-view/service/three-engine/managers/label-manager.service.ts

import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { CelestialInstanceData } from './object-manager.service';

// ====================================================================
// --- ✨ CONSTANTES AJUSTADAS PARA MEJOR VISIBILIDAD ✨ ---
// ====================================================================

const LABEL_VISIBILITY_DISTANCE = 50_000_000_000; // Distancia AUMENTADA para escala cósmica.
const LABEL_FONT_SIZE = 72; // Tamaño de fuente aún más grande para mayor impacto.
const LABEL_FONT_FAMILY = 'Arial, sans-serif';
const LABEL_TEXT_COLOR = 'rgba(255, 255, 255, 1)'; // Blanco puro para máximo contraste.
const LABEL_PADDING = 10; // Padding ajustado para la sombra.
const LABEL_SCALE_FACTOR = 18.0; // Multiplicador para el tamaño base de la etiqueta.

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
  isVisible: boolean;
}

/**
 * @class LabelManagerService
 * @description
 * Gestiona la creación, visibilidad y ciclo de vida de las etiquetas de texto (THREE.Sprite)
 * que se muestran sobre los objetos en la escena 3D.
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
    // Para objetos estándar, calculamos el radio a partir de su bounding box.
    const radius = this.tempBox.getSize(this.tempVec3).length() / 2;

    this.registeredLabels.set(object.uuid, {
      uuid: object.uuid,
      name: object.name,
      targetObject: object,
      targetPosition: object.position.clone(),
      targetRadius: Math.max(radius, 1.0),
      sprite: null,
      isVisible: false,
    });
  }

  /**
   * Registra los datos de una instancia celeste para que pueda mostrar su etiqueta.
   * @param instanceData - Los datos de la instancia celeste.
   */
  public registerInstancedObject(instanceData: CelestialInstanceData): void {
    if (this.registeredLabels.has(instanceData.originalUuid)) return;

    // Para billboards instanciados, el radio es simplemente la escala máxima.
    const radius = Math.max(instanceData.scale.x, instanceData.scale.y, instanceData.scale.z);

    this.registeredLabels.set(instanceData.originalUuid, {
      uuid: instanceData.originalUuid,
      name: instanceData.originalName,
      targetPosition: instanceData.position.clone(),
      targetRadius: radius,
      sprite: null,
      isVisible: false,
    });
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
   * El bucle de actualización principal, llamado desde EngineService.
   * Gestiona qué etiquetas deben ser visibles en cada fotograma.
   * @param camera - La cámara activa.
   */
  public update(camera: THREE.Camera): void {
    const visibleUuids = new Set<string>();

    this.registeredLabels.forEach((labelData) => {
      const position = labelData.targetObject ? labelData.targetObject.position : labelData.targetPosition;
      const distance = camera.position.distanceTo(position);

      // La distancia de visibilidad ahora es proporcional al tamaño del objeto.
      const visibilityThreshold = LABEL_VISIBILITY_DISTANCE * (labelData.targetRadius / 10000);

      if (distance < visibilityThreshold) {
        visibleUuids.add(labelData.uuid);
        if (!this.activeLabels.has(labelData.uuid)) {
          this._activateLabel(labelData);
        }
        
        const activeLabel = this.activeLabels.get(labelData.uuid);
        if (activeLabel && activeLabel.sprite) {
          // ✨ LÓGICA DE POSICIONAMIENTO MEJORADA: Más alto y siempre proporcional.
          const yOffset = labelData.targetRadius * 80.2;
          activeLabel.sprite.position.copy(position).add(new THREE.Vector3(0, yOffset, 0));
        }
      }
    });

    // Desactiva las etiquetas que ya no están en el rango visible.
    this.activeLabels.forEach((activeLabel) => {
      if (!visibleUuids.has(activeLabel.uuid)) {
        this._deactivateLabel(activeLabel);
      }
    });
  }

  /** Limpia todas las etiquetas y registros. */
  public clear(): void {
    this.activeLabels.forEach(label => this._deactivateLabel(label));
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
    labelData.isVisible = true;

    this.scene.add(sprite);
    this.activeLabels.set(labelData.uuid, labelData);
  }

  private _deactivateLabel(labelData: ManagedLabel): void {
    if (labelData.sprite) {
      labelData.sprite.visible = false;
      this.scene.remove(labelData.sprite);
      this.labelPool.push(labelData.sprite);
    }
    labelData.sprite = null;
    labelData.isVisible = false;
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
   * Crea o actualiza la textura de un sprite con el texto del nombre.
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
    
    // ✨ LÓGICA DE DIBUJO CORREGIDA ✨
    // 1. Ya no se dibuja el fondo (context.fill() está eliminado).
    
    // 2. Se añade una sombra para mejorar la legibilidad.
    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 10;
    
    // 3. Se dibuja el texto.
    context.fillStyle = LABEL_TEXT_COLOR;
    context.fillText(labelData.name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    sprite.material.map = texture;
    
    const aspect = canvas.width / canvas.height;
    const baseScale = labelData.targetRadius * LABEL_SCALE_FACTOR;
    sprite.scale.set(baseScale * aspect, baseScale, 1.0);
  }

  // Helper para dibujar rectángulos redondeados (ya no se usa para el fill, pero se mantiene por si se necesita en el futuro).
  private _roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}