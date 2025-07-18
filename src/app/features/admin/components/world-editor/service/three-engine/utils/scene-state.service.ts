import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root'
})
export class SceneStateService {
  // Un BehaviorSubject para la lista de objetos. Emite la lista actual a los suscriptores.
  private readonly _objectsInScene$ = new BehaviorSubject<THREE.Object3D[]>([]);
  // Un BehaviorSubject para el objeto actualmente seleccionado.
  private readonly _selectedObject$ = new BehaviorSubject<THREE.Object3D | null>(null);

  /** Observable público para que los componentes se suscriban a la lista de objetos. */
  public readonly objectsInScene$: Observable<THREE.Object3D[]> = this._objectsInScene$.asObservable();
  
  /** Observable público para que los componentes se suscriban al objeto seleccionado. */
  public readonly selectedObject$: Observable<THREE.Object3D | null> = this._selectedObject$.asObservable();

  constructor() { }

  /**
   * El EngineService llamará a este método para actualizar la lista de objetos.
   */
  public updateObjectsList(objects: THREE.Object3D[]): void {
    this._objectsInScene$.next(objects);
  }

  /**
   * El WorldViewComponent (la UI) llamará a esto cuando el usuario seleccione un objeto.
   */
  public selectObject(object: THREE.Object3D | null): void {
    // Evita emitir el mismo valor repetidamente
    if (this._selectedObject$.getValue() !== object) {
      this._selectedObject$.next(object);
    }
  }

  /**
   * Devuelve el objeto actualmente seleccionado de forma síncrona.
   */
  public getSelectedObject(): THREE.Object3D | null {
    return this._selectedObject$.getValue();
  }
}