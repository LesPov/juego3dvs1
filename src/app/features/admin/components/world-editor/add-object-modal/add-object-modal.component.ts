// src/app/features/admin/world-editor/add-object-modal/add-object-modal.component.ts

import { Component, EventEmitter, OnInit, Output, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SceneObjectResponse, AssetResponse } from '../../../services/admin.service';
import { AssetService } from '../../../services/asset-cache.service'; // Asegúrate que el nombre del servicio importado sea el correcto

export type NewSceneObjectData = Omit<SceneObjectResponse, 'id' | 'asset'>;

@Component({
  selector: 'app-add-object-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './add-object-modal.component.html',
  styleUrls: ['./add-object-modal.component.css']
})
export class AddObjectModalComponent implements OnInit, OnDestroy {
  public Object = Object;
  @Output() close = new EventEmitter<void>();
  @Output() create = new EventEmitter<NewSceneObjectData>();

  objectForm!: FormGroup;
  private typeChangesSubscription?: Subscription;

  // --- ¡MODIFICACIÓN CLAVE #1! ---
  // Añadimos todos los tipos de objetos que soportará el editor.
  objectTypes: SceneObjectResponse['type'][] = [
    'cube', 'sphere', 'floor', 'model', 
    'camera', 'ambientLight', 'directionalLight', 'pointLight'
  ];

  modelAssets: AssetResponse[] = [];

  constructor(
    private fb: FormBuilder,
    private assetService: AssetService // Usando tu servicio de cache de assets
  ) { }

  ngOnInit(): void {
    this.buildForm();
    this.listenToTypeChanges();
    this.loadAssets();
  }

  private loadAssets(): void {
    // Asumo que tu servicio se llama `AssetService` como en los archivos que pasaste
    // Si es `AssetCacheService`, solo cambia el nombre aquí.
    this.assetService.getAssets().subscribe(allAssets => {
      this.modelAssets = allAssets.filter(asset => asset.type === 'model_glb');
    });
  }

  private buildForm(): void {
    this.objectForm = this.fb.group({
      name: ['', Validators.required],
      type: ['cube', Validators.required],
      assetId: [null as number | null],
      position: this.fb.group({ x: [0, Validators.required], y: [5, Validators.required], z: [10, Validators.required] }),
      rotation: this.fb.group({ x: [0, Validators.required], y: [0, Validators.required], z: [0, Validators.required] }),
      scale: this.fb.group({ x: [1, Validators.required], y: [1, Validators.required], z: [1, Validators.required] }),
      properties: this.fb.group({})
    });
  }

  private listenToTypeChanges(): void {
    const typeControl = this.objectForm.get('type');
    if (!typeControl) return;

    this.typeChangesSubscription = typeControl.valueChanges.subscribe(type => {
      const propertiesGroup = this.objectForm.get('properties') as FormGroup;
      const assetIdControl = this.objectForm.get('assetId');

      // Limpiamos todo para empezar de cero en cada cambio de tipo
      Object.keys(propertiesGroup.controls).forEach(key => propertiesGroup.removeControl(key));
      assetIdControl?.reset();
      assetIdControl?.disable();
      assetIdControl?.clearValidators();

      // --- ¡MODIFICACIÓN CLAVE #2! ---
      // Lógica dinámica para construir el formulario según el tipo de objeto.
      switch (type) {
        case 'model':
          assetIdControl?.enable();
          assetIdControl?.setValidators([Validators.required]);
          propertiesGroup.addControl('overrideColor', this.fb.control('#ffffff'));
          break;
        
        case 'camera':
          propertiesGroup.addControl('fov', this.fb.control(50, [Validators.required, Validators.min(1)]));
          propertiesGroup.addControl('near', this.fb.control(0.1, [Validators.required, Validators.min(0.01)]));
          propertiesGroup.addControl('far', this.fb.control(1000, [Validators.required, Validators.min(1)]));
          break;

        case 'ambientLight':
        case 'directionalLight':
        case 'pointLight':
          propertiesGroup.addControl('color', this.fb.control('#ffffff', Validators.required));
          propertiesGroup.addControl('intensity', this.fb.control(1.0, [Validators.required, Validators.min(0)]));
          
          if (type === 'pointLight') {
            propertiesGroup.addControl('distance', this.fb.control(0, [Validators.required, Validators.min(0)]));
            propertiesGroup.addControl('decay', this.fb.control(2, [Validators.required, Validators.min(0)]));
          }
          break;
        
        case 'cube':
        case 'sphere':
        case 'floor':
        default:
          propertiesGroup.addControl('color', this.fb.control('#cccccc', Validators.required));
          break;
      }
      assetIdControl?.updateValueAndValidity();
    });
    // Inicializamos el formulario con el tipo por defecto
    typeControl.setValue('cube');
  }

  onSubmit(): void {
    if (this.objectForm.invalid) {
      this.objectForm.markAllAsTouched();
      return;
    }
    this.create.emit(this.objectForm.getRawValue() as NewSceneObjectData);
  }

  onClose(): void {
    this.close.emit();
  }

  // Getters para acceso fácil desde la plantilla
  get colorControl(): FormControl | null { return this.objectForm.get('properties.color') as FormControl | null; }
  get overrideColorControl(): FormControl | null { return this.objectForm.get('properties.overrideColor') as FormControl | null; }

  ngOnDestroy(): void {
    this.typeChangesSubscription?.unsubscribe();
  }
}