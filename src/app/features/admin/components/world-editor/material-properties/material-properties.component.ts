import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SceneObjectResponse } from '../../../services/admin.service';

export interface MaterialUpdate {
  type: 'material';
  property: 'color' | 'overrideColor';
  value: string;
}

@Component({
  selector: 'app-material-properties',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './material-properties.component.html',
  styleUrls: ['./material-properties.component.css']
})
export class MaterialPropertiesComponent {
  @Input() selectedObject!: SceneObjectResponse;
  @Output() materialChange = new EventEmitter<MaterialUpdate>();

  onColorChange(property: 'color' | 'overrideColor', event: Event) {
    const input = event.target as HTMLInputElement;
    this.materialChange.emit({
      type: 'material',
      property: property,
      value: input.value
    });
  }

  // Helper para obtener el color actual y evitar errores en la plantilla
  getCurrentColor(property: 'color' | 'overrideColor'): string {
    return this.selectedObject.properties?.[property] || '#ffffff';
  }
}