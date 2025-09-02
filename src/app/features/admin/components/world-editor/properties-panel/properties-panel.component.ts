import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SceneObjectResponse } from '../../../services/admin.service';

// Componentes Hijos
import { TransformPropertiesComponent, TransformUpdate } from '../transform-properties/transform-properties.component';
import { CustomPropertiesComponent } from '../custom-properties/custom-properties.component';
import { MetadataPropertiesComponent } from '../metadata-properties/metadata-properties.component';

export interface NameUpdate {
  path: 'name';
  value: string;
}
export type PropertyUpdate = TransformUpdate | NameUpdate;

@Component({
  selector: 'app-properties-panel',
  standalone: true,
  // ¡IMPORTANTE! Añade los nuevos componentes al array de imports
  imports: [
    CommonModule, 
    FormsModule, 
    TransformPropertiesComponent,
    CustomPropertiesComponent,
    MetadataPropertiesComponent
  ],
  templateUrl: './properties-panel.component.html',
  styleUrls: ['./properties-panel.component.css']
})
export class PropertiesPanelComponent implements OnChanges {
  @Input() selectedObject: SceneObjectResponse | null = null;
  @Output() objectUpdate = new EventEmitter<PropertyUpdate>();
  
  public editableObjectName: string = '';
  // LÓGICA ELIMINADA: La propiedad `objectProperties` ya no es necesaria aquí.
  // LÓGICA ELIMINADA: El método `parseObjectProperties` ya no es necesario aquí.
  // LÓGICA ELIMINADA: El método `formatPropertyValue` ya no es necesario aquí.

  constructor() {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedObject'] && this.selectedObject) {
      this.editableObjectName = this.selectedObject.name;
    }
  }

  onTransformChange(update: TransformUpdate): void {
    this.objectUpdate.emit(update);
  }

  onNameChange(): void {
    if (!this.selectedObject || this.selectedObject.name === this.editableObjectName) return;
    
    this.objectUpdate.emit({
        path: 'name',
        value: this.editableObjectName
    });
  }
}