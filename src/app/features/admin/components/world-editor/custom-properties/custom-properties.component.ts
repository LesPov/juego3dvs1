import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SceneObjectResponse } from '../../../services/admin.service';

@Component({
  selector: 'app-custom-properties',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './custom-properties.component.html',
  styleUrls: ['./custom-properties.component.css']
})
export class CustomPropertiesComponent implements OnChanges {
  // Recibe el objeto completo desde el componente padre
  @Input() selectedObject: SceneObjectResponse | null = null;
  
  // Array local para renderizar en la plantilla
  public displayProperties: { key: string, value: any }[] = [];

  constructor() { }

  ngOnChanges(changes: SimpleChanges): void {
    // Cada vez que el objeto seleccionado cambie, procesamos sus propiedades
    if (changes['selectedObject']) {
      this.parseObjectProperties();
    }
  }

  // Transforma el objeto `properties` en un array para el template.
  private parseObjectProperties(): void {
    if (!this.selectedObject || !this.selectedObject.properties) {
      this.displayProperties = [];
      return;
    }
    this.displayProperties = Object.entries(this.selectedObject.properties)
      .map(([key, value]) => ({ key, value }));
  }
  
  // Función para formatear valores en el HTML de forma consistente.
  public formatPropertyValue(value: any): string {
    if (typeof value === 'number') {
      return value.toFixed(4);
    }
    return String(value);
  }
}