// src/app/features/admin/components/world-editor/add-object-modal/add-object-modal.component.ts
import { Component, EventEmitter, OnInit, Output, OnDestroy } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SceneObjectResponse, AssetResponse } from '../../../services/admin.service';
import { AssetService } from '../../../services/asset-cache.service';

export type NewSceneObjectData = Omit<SceneObjectResponse, 'id' | 'asset'>;

interface ObjectPrefab {
  id: string;
  name: string;
  type: SceneObjectResponse['type'];
  icon: string;
  description: string;
  defaultValues: {
    name: string;
    scale?: { x: number, y: number, z: number };
    properties?: { [key: string]: any };
  };
}

interface PrefabCategory {
  name: string;
  items: ObjectPrefab[];
}

@Component({
  selector: 'app-add-object-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TitleCasePipe],
  templateUrl: './add-object-modal.component.html',
  styleUrls: ['./add-object-modal.component.css']
})
export class AddObjectModalComponent implements OnInit, OnDestroy {
  public Object = Object;

  @Output() close = new EventEmitter<void>();
  @Output() create = new EventEmitter<NewSceneObjectData>();

  objectForm!: FormGroup;
  private typeChangesSubscription?: Subscription;
  
  activeTab: 'library' | 'advanced' = 'library';

  prefabCategories: PrefabCategory[] = [
    {
      name: 'Mallas y Construcción',
      items: [
        { id: 'box', name: 'Caja', type: 'cube', icon: '🧊', description: 'Un cubo simple. La base para construir.', defaultValues: { name: 'Caja', scale: { x: 1, y: 1, z: 1 }, properties: { color: '#cccccc', castShadow: true, receiveShadow: true } } },
        { id: 'wall', name: 'Pared', type: 'cube', icon: '🧱', description: 'Un bloque alargado, ideal para muros y estructuras.', defaultValues: { name: 'Pared', scale: { x: 5, y: 3, z: 0.2 }, properties: { color: '#d4c2ad', castShadow: true, receiveShadow: true } } },
        { id: 'floor', name: 'Suelo', type: 'floor', icon: '🟩', description: 'Una superficie plana que recibe sombras.', defaultValues: { name: 'Suelo', scale: { x: 20, y: 0.1, z: 20 }, properties: { color: '#808080', receiveShadow: true } } },
        { id: 'sphere', name: 'Esfera', type: 'sphere', icon: '⚽', description: 'Una esfera perfecta.', defaultValues: { name: 'Esfera', scale: { x: 1, y: 1, z: 1 }, properties: { color: '#cccccc', castShadow: true, receiveShadow: true } } },
        { id: 'cone', name: 'Pirámide', type: 'cone', icon: '🔺', description: 'Una forma cónica, para tejados o pirámides.', defaultValues: { name: 'Pirámide', scale: { x: 1, y: 1, z: 1 }, properties: { color: '#cccccc', castShadow: true, receiveShadow: true } } },
        { id: 'torus', name: 'Dona', type: 'torus', icon: '🍩', description: 'Una forma de toroide o dona.', defaultValues: { name: 'Dona', scale: { x: 1, y: 1, z: 1 }, properties: { color: '#cccccc', castShadow: true, receiveShadow: true } } },
      ]
    },
    {
      name: 'Luces y Ayudantes',
      items: [
        { id: 'directionalLight', name: 'Luz Direccional', type: 'directionalLight', icon: '☀️', description: 'Simula la luz del sol, con rayos paralelos.', defaultValues: { name: 'Luz del Sol', properties: { color: '#ffffff', intensity: 1, castShadow: true } } },
        { id: 'camera', name: 'Cámara', type: 'camera', icon: '📷', description: 'Define un punto de vista en la escena.', defaultValues: { name: 'Cámara', properties: { fov: 50, near: 0.1, far: 1000 } } },
      ]
    },
    {
      name: 'Assets Externos',
      items: [
        { id: 'model', name: 'Modelo 3D', type: 'model', icon: '🚀', description: 'Importa un modelo .glb de tu biblioteca de assets.', defaultValues: { name: 'Modelo importado', scale: { x: 1, y: 1, z: 1 } } },
      ]
    }
  ];

  modelAssets: AssetResponse[] = [];

  constructor(private fb: FormBuilder, private assetService: AssetService) {}

  ngOnInit(): void {
    this.buildForm();
    this.listenToTypeChanges();
    this.loadAssets();
  }

  ngOnDestroy(): void {
    this.typeChangesSubscription?.unsubscribe();
  }

  private loadAssets(): void {
    this.assetService.getAssets().subscribe(allAssets => {
      this.modelAssets = allAssets.filter(asset => asset.type === 'model_glb');
    });
  }

  private buildForm(): void {
    this.objectForm = this.fb.group({
      name: ['', Validators.required],
      type: ['cube', Validators.required],
      assetId: [null as number | null],
      position: this.fb.group({ x: [0, Validators.required], y: [0, Validators.required], z: [0, Validators.required] }),
      rotation: this.fb.group({ x: [0, Validators.required], y: [0, Validators.required], z: [0, Validators.required] }),
      scale: this.fb.group({ x: [1, Validators.required], y: [1, Validators.required], z: [1, Validators.required] }),
      properties: this.fb.group({})
    });
  }

  private listenToTypeChanges(): void {
    const typeControl = this.objectForm.get('type');
    if (!typeControl) return;

    this.typeChangesSubscription = typeControl.valueChanges.subscribe((type: SceneObjectResponse['type']) => {
      this.updateFormBasedOnType(type, {});
    });
  }
  
  private updateFormBasedOnType(type: SceneObjectResponse['type'], defaultProperties: any = {}): void {
      const propertiesGroup = this.objectForm.get('properties') as FormGroup;
      const assetIdControl = this.objectForm.get('assetId');

      Object.keys(propertiesGroup.controls).forEach(key => propertiesGroup.removeControl(key));
      assetIdControl?.reset();
      assetIdControl?.disable();
      assetIdControl?.clearValidators();
      
      for (const key in defaultProperties) {
        if (Object.prototype.hasOwnProperty.call(defaultProperties, key)) {
          propertiesGroup.addControl(key, this.fb.control(defaultProperties[key]));
        }
      }

      if (type === 'model') {
        assetIdControl?.enable();
        assetIdControl?.setValidators([Validators.required]);
      }
      
      assetIdControl?.updateValueAndValidity();
  }

  selectPrefab(prefab: ObjectPrefab): void {
    const defaultScale = prefab.defaultValues.scale || { x: 1, y: 1, z: 1 };

    this.objectForm.patchValue({
        name: prefab.defaultValues.name,
        type: prefab.type,
        scale: defaultScale,
        position: { x:0, y:0, z:0 },
        rotation: { x:0, y:0, z:0 }
    });
    this.updateFormBasedOnType(prefab.type, prefab.defaultValues.properties);
    this.activeTab = 'advanced';
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
  
  get propertiesFormGroup(): FormGroup {
    return this.objectForm.get('properties') as FormGroup;
  }
}