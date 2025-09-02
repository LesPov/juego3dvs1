// src/app/features/admin/views/world-editor/transform-properties/transform-properties.component.ts
import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subscription } from 'rxjs';
import { SceneObjectResponse } from '../../../services/admin.service';

export interface TransformUpdate {
  type: 'transform';
  path: 'position' | 'rotation' | 'scale';
  value: { x: number; y: number; z: number };
}

@Component({
  selector: 'app-transform-properties',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './transform-properties.component.html',
  styleUrls: ['./transform-properties.component.css'] 
})
export class TransformPropertiesComponent implements OnChanges, OnDestroy {
  @Input() selectedObject!: SceneObjectResponse;
  @Output() transformChange = new EventEmitter<TransformUpdate>();

  transformForm: FormGroup;
  private formSubscription: Subscription | null = null;
  rotationModes = ['Euler XYZ', 'Euler XZY', 'Euler YXZ', 'Euler YZX', 'Euler ZXY', 'Euler ZYX', 'Quaternion', 'Axis Angle'];

  constructor(private fb: FormBuilder) {
    this.transformForm = this.fb.group({
      position: this.fb.group({ x: [0], y: [0], z: [0] }),
      rotation: this.fb.group({ x: [0], y: [0], z: [0] }),
      scale: this.fb.group({ x: [1], y: [1], z: [1] }),
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedObject'] && this.selectedObject) {
      this.formSubscription?.unsubscribe();
      this.transformForm.patchValue(this.selectedObject, { emitEvent: false });

      this.formSubscription = this.transformForm.valueChanges.pipe(
        debounceTime(400),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr))
      ).subscribe(formValue => {
          this.detectAndEmitChange(formValue);
      });
    }
  }
  
  private detectAndEmitChange(formValue: any): void {
    const original = this.selectedObject;
    
    if (JSON.stringify(original.position) !== JSON.stringify(formValue.position)) {
        this.transformChange.emit({ type: 'transform', path: 'position', value: formValue.position });
        return;
    }
    if (JSON.stringify(original.rotation) !== JSON.stringify(formValue.rotation)) {
        this.transformChange.emit({ type: 'transform', path: 'rotation', value: formValue.rotation });
        return;
    }
    if (JSON.stringify(original.scale) !== JSON.stringify(formValue.scale)) {
        this.transformChange.emit({ type: 'transform', path: 'scale', value: formValue.scale });
        return;
    }
  }

  ngOnDestroy(): void {
    this.formSubscription?.unsubscribe();
  }
}