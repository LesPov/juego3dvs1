// src/app/core/services/scene-object/scene-object.service.ts

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SceneObjectResponse } from './admin.service';
// <-- ¡CAMBIO CLAVE! Importamos la interfaz actualizada desde su ubicación correcta.
 
@Injectable({
  providedIn: 'root'
})
export class SceneObjectService {
  private baseUrl = environment.endpoint.endsWith('/')
    ? environment.endpoint.slice(0, -1)
    : environment.endpoint;

  constructor(private http: HttpClient) {}

  private getObjectsUrl(episodeId: number): string {
    return `${this.baseUrl}/api/episodes/${episodeId}/objects`;
  }

  createSceneObject(episodeId: number, objectData: Partial<SceneObjectResponse>): Observable<SceneObjectResponse> {
    console.log(`[SceneObjectService] Creando nuevo objeto en episodio ${episodeId}`, objectData);
    return this.http.post<SceneObjectResponse>(this.getObjectsUrl(episodeId), objectData);
  }

  /**
   * Actualiza un objeto de escena existente.
   * Gracias a la interfaz actualizada, ahora puedes enviar campos directamente como:
   * { emissiveColor: '#FF0000' } o { isVisible: false }
   */
  updateSceneObject(
    episodeId: number,
    objectId: number,
    dataToUpdate: Partial<SceneObjectResponse>
  ): Observable<SceneObjectResponse> {

    console.log(`[SceneObjectService] Actualizando objeto ${objectId} con:`, dataToUpdate);
    const updateUrl = `${this.getObjectsUrl(episodeId)}/${objectId}`;
    return this.http.put<SceneObjectResponse>(updateUrl, dataToUpdate);
  }
}