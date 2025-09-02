import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SceneObjectResponse } from '../../../services/admin.service';

// Tipos de datos para una comunicación clara
type Vector3 = { x: number; y: number; z: number };
export interface PropertyUpdate {
  path: 'position' | 'rotation' | 'scale' | 'name';
  value: Vector3 | string;
}

@Component({
  selector: 'app-properties-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './properties-panel.component.html',
  styleUrls: ['./properties-panel.component.css']
})
export class PropertiesPanelComponent implements OnChanges {
  @Input() selectedObject: SceneObjectResponse | null = null;
  @Output() objectUpdate = new EventEmitter<PropertyUpdate>();
  
  public name: string = '';
  public position: Vector3 = { x: 0, y: 0, z: 0 };
  public rotation: Vector3 = { x: 0, y: 0, z: 0 };
  public scale: Vector3 = { x: 1, y: 1, z: 1 };

  private isDragging = false;
  private dragStartValue = 0;
  private dragStartY = 0; // Cambiado a Y para el arrastre vertical
  private dragProperty: 'position' | 'rotation' | 'scale' | null = null;
  private dragAxis: 'x' | 'y' | 'z' | null = null;
  private dragSensitivity = 0.05;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedObject'] && this.selectedObject) {
      this.name = this.selectedObject.name;
      this.position = { ...this.selectedObject.position };
      this.rotation = { ...this.selectedObject.rotation };
      this.scale = { ...this.selectedObject.scale };
    }
  }

  onTransformChange(path: 'position' | 'rotation' | 'scale'): void {
    if (!this.selectedObject) return;
    this.objectUpdate.emit({ path, value: { ...this[path] } });
  }

  onNameChange(): void {
    if (!this.selectedObject || this.selectedObject.name === this.name) return;
    this.objectUpdate.emit({ path: 'name', value: this.name });
  }

  /**
   * INICIO DE LA MEJORA: Lógica de arrastre vertical
   */
  startDrag(event: MouseEvent, property: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z'): void {
    // Prevenir que el texto del input sea seleccionado
    event.preventDefault(); 
    
    this.isDragging = true;
    this.dragProperty = property;
    this.dragAxis = axis;
    this.dragStartY = event.clientY; // Usamos la posición Y del cursor
    this.dragStartValue = this[property][axis];
    
    this.dragSensitivity = (property === 'position') ? 0.5 : 0.01;
    if (event.shiftKey) this.dragSensitivity *= 10;
    if (event.altKey) this.dragSensitivity *= 0.1;

    document.body.style.cursor = 'ns-resize'; // Cambiar el cursor globalmente
    document.addEventListener('mousemove', this.handleDrag);
    document.addEventListener('mouseup', this.stopDrag);
  }

  private handleDrag = (event: MouseEvent): void => {
    if (!this.isDragging || !this.dragProperty || !this.dragAxis) return;

    // Calculamos el delta vertical. Arrastrar hacia arriba (menor clientY) incrementa el valor.
    const deltaY = this.dragStartY - event.clientY; 
    const newValue = this.dragStartValue + (deltaY * this.dragSensitivity);
    
    (this[this.dragProperty] as Vector3)[this.dragAxis] = parseFloat(newValue.toFixed(4));
    
    this.onTransformChange(this.dragProperty);
  };

  private stopDrag = (): void => {
    this.isDragging = false;
    this.dragProperty = null;
    this.dragAxis = null;
    
    document.body.style.cursor = 'default'; // Restaurar el cursor
    document.removeEventListener('mousemove', this.handleDrag);
    document.removeEventListener('mouseup', this.stopDrag);
  };
}