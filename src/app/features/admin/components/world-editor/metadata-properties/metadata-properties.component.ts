import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SceneObjectResponse } from '../../../services/admin.service';

@Component({
  selector: 'app-metadata-properties',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './metadata-properties.component.html',
  styleUrls: ['./metadata-properties.component.css']
})
export class MetadataPropertiesComponent {
  // Solo necesita recibir el objeto seleccionado.
  @Input() selectedObject: SceneObjectResponse | null = null;

  constructor() { }
}